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
    const hData = buildNodeHierarchy(nodes);
    const root = diagram.tree(d3.hierarchy(hData));

    //links
    let linkGroup = diagram.linkGroup
        .selectAll(".link-group")
        .data(root.links(), d => d.target.data.id);
        
    linkGroup.join(
        enter => enter.append("g")
            .classed("link-group", true)
            .append("line")
                .transition()
                .attr("x1", d => getRadial(d.source.x, d.source.y)[0])
                .attr("y1", d => getRadial(d.source.x, d.source.y)[1])
                .attr("x2", d => getRadial(d.target.x, d.target.y)[0])
                .attr("y2", d => getRadial(d.target.x, d.target.y)[1]),
        update => update.select("line")
            .transition()
            .attr("x1", d => getRadial(d.source.x, d.source.y)[0])
            .attr("y1", d => getRadial(d.source.x, d.source.y)[1])
            .attr("x2", d => getRadial(d.target.x, d.target.y)[0])
            .attr("y2", d => getRadial(d.target.x, d.target.y)[1]),
        exit => exit.select("line")
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
        .data(root.descendants(), d => d.data.id);

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