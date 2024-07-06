export function init(zoom) {
    const radius = Math.min(diagram.dimensions.width, diagram.dimensions.height) / 2 - 80;

    diagram.tree = d3.cluster()
        .size([2 * Math.PI, radius])

    diagram.svgGroup.attr("transform", `translate(${diagram.dimensions.width/2},${diagram.dimensions.height/2})`);

    //zoom initial transition
    const initialTransform = d3.zoomIdentity
        .translate(diagram.dimensions.width/2, diagram.dimensions.height/2);

    diagram.svg.call(zoom)
        .call(zoom.transform, initialTransform);
}

export function update() {
    let nodes = filterNodes(data.nodes);
    const nestedData = buildNodeHierarchy(nodes);
    const root = diagram.tree(d3.hierarchy(nestedData));
    const inputNodes = root.descendants();

    //add id property to the link (used to identify them for pulse generation)
    const inputLinks = root.links().map(link => ({ 
        ...link,
        id: `${link.source.data.id}-${link.target.data.id}`
    }));
    
    //create a iteration-specific link pulse array
    let pulse = [];
    const regex = /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}-[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/; //mac-to-mac link regex
    for (let lnk of diagram.pulse) { //src_mac->dst_mac links replaced with root-src_mac and root-dst_mac
        if (regex.test(lnk)) {
            pulse.push(`root-${lnk.split("-")[0]}`);
            pulse.push(`root-${lnk.split("-")[1]}`);
        } else {
            pulse.push(lnk);
        }
    }
    pulse = [...new Set(pulse)]; //remove any duplicates

    d3.select(".node .link").interrupt();
    
    //links
    let linkGroup = diagram.linkGroup
        .selectAll(".link-group")
        .data(inputLinks, d => d.id);
        
    linkGroup.join(
        enter => enter.append("g")
            .classed("link-group", true)
            .append("line")
                .classed("link", true)
                .transition()
                .attr("x1", d => getRadial(d.source.x, d.source.y)[0])
                .attr("y1", d => getRadial(d.source.x, d.source.y)[1])
                .attr("x2", d => getRadial(d.target.x, d.target.y)[0])
                .attr("y2", d => getRadial(d.target.x, d.target.y)[1]),
        update => update.select(".link")
            .transition()
            .attr("x1", d => getRadial(d.source.x, d.source.y)[0])
            .attr("y1", d => getRadial(d.source.x, d.source.y)[1])
            .attr("x2", d => getRadial(d.target.x, d.target.y)[0])
            .attr("y2", d => getRadial(d.target.x, d.target.y)[1])
            .on("end", function () {
                if (pulse.includes(this.__data__.id)) {
                    doPulse(d3.select(this));
                }
            }),
        exit => exit.select(".link")
            .transition()
            .attr("x1", 0)
            .attr("y1", 0)
            .attr("x2", 0)
            .attr("y2", 0)
            .on("end", () => exit.remove()) //remove parent g when done
    );

    //nodes
    let nodeGroup = diagram.nodeGroup
        .selectAll(".node-group")
        .data(inputNodes, d => d.data.id);

    nodeGroup.join(
        enter => enter.append("g")
            .classed("node-group", true)
            .call(enter => enter.append("circle")
                .attr("class", d => `node ${d.data.type}`)
                .on("click", showDetails)
                .transition()
                .attr("transform", d => `rotate(${d.x * 180 / Math.PI - 90}) translate(${d.y},0)`)
            )
            .call(enter => enter.append("text")
                .classed("label", true)
                .attr("transform", d => `rotate(${d.x * 180 / Math.PI - 90}) translate(${d.y},0) rotate(${d.x >= Math.PI ? 180 : 0})`)
                .attr("x", d => d.x < Math.PI === !d.children ? 40 : -40)
                .attr("text-anchor", d => d.x < Math.PI === !d.children ? "start" : "end")
                .text(d => d.data.name)
            ),
        update => update
            .call(update => update.select("circle")
                .transition()
                .attr("transform", d => `rotate(${d.x * 180 / Math.PI - 90}) translate(${d.y},0)`)
            )
            .call(update => update.select("text")
                .attr("x", d => d.x < Math.PI === !d.children ? 40 : -40)
                .attr("text-anchor", d => d.x < Math.PI === !d.children ? "start" : "end")
                .transition()
                .attr("transform", d => `rotate(${d.x * 180 / Math.PI - 90}) translate(${d.y},0) rotate(${d.x >= Math.PI ? 180 : 0})`)
            ),
        exit => exit
            .call(exit => exit.select("text").remove()) //remove child text first
            .select("circle")
            .transition()
            .attr("transform", d => `rotate(${d.x * 180 / Math.PI - 90}) translate(0,0)`)
            .on("end", () => exit.remove()) //remove parent g when done
    );

    //reset pulse array
    diagram.pulse = []

    function doPulse(linkSelection) {
        let pulseDuration = 500;

        linkSelection
            .style("stroke-width", 5)
            .style("stroke", "red")
            .transition()
            .duration(pulseDuration)
            .ease(d3.easePolyIn.exponent(3))
            .style("stroke-width", 1)
            .style("stroke", "grey");

        d3.selectAll(".node")
            .filter(d => d.data.id === linkSelection.data()[0].source.data.id || d.data.id === linkSelection.data()[0].target.data.id) //include source and target nodes
            .style("stroke-width", 10)
            .style("stroke", "red")
            .transition()
            .duration(pulseDuration)
            .ease(d3.easePolyIn.exponent(3))
            .style("stroke", d => d.data.id === "root" ? "grey" : "black")
            .style("stroke-width", 1);
    }
}

export function center() {
    diagram.dimensions = diagram.svg.node().getBoundingClientRect();
    diagram.svgGroup.attr("transform", `translate(${diagram.dimensions.width/2},${diagram.dimensions.height/2})`);
}

function buildNodeHierarchy(nodes) {
    const root = {id:"root", name: null, type: "net", children:[]};

    if (nodes.map(d => d.addr_type).includes("eth")) {
        for (let node of nodes.filter(d => d.addr_type === "eth")) {
            let obj = {id: node.addr, name: node.addr, type: "eth", children: []};
            root.children.push(obj);
            
            for (let ip of node.assoc_ip) {
                if (nodes.map(d => d.id).includes(ip.id)) {
                    obj.children.push({id: `${node.addr},${ip.addr}`, name: ip.addr, type: ip.addr_type});
                }
            }
        }
    } else {
        for(let node of nodes) {
            root.children.push({id: node.id, name: node.addr, type: node.addr_type});
        }
    }

    return root;
}

function getRadial(x, y) {
    return [y * Math.cos(x - Math.PI / 2), y * Math.sin(x - Math.PI / 2)];
}