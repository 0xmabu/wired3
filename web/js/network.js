export function init() {
    diagram.simulation = d3.forceSimulation()
        .force("center", d3.forceCenter(diagram.dimensions.width/2, diagram.dimensions.height/2)) //nodes center around point
        .force("charge", d3.forceManyBody().strength(-50)) //nodes attract or repell
        .force("collide", d3.forceCollide(15)) //area around node to prevent overlap
        .force("link", d3.forceLink().id(d => d.id).distance(45)) //length (and potential strength) of links
        .on("tick", ticked);

    function ticked() {
        diagram.linkGroup.selectAll(".link")
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

    diagram.nodeGroup.selectAll(".node-group")
        .attr("transform", d => `translate(${d.x} ${d.y})`);
    }
}

export function update() {
    //get data
    let nodes = filterNodes(data.nodes)
    let links = filterLinks(nodes, data.links)
    let linkWidthScale = getLinkScale(links);
    
    //create nodes
    let nodeGroup = diagram.nodeGroup.selectAll(".node-group").data(nodes, d => d.id);
    nodeGroup.join(
        enter => enter.append("g")
            .classed("node-group", true)
            .attr("opacity", d => d.sender === true ? 1 : 0.3)
            .call(enter => enter.append("circle")
                .attr("class", d => `node ${d.addr_type} ${d.cast_type}`)
                .on("click", showDetails)
                .append("title").text(d => d.vendor !== null ? d.vendor : (d.cast_type === "ucast" ? "Unknown" : null))
            )
            .call(enter => enter.append("text")
                .classed("label", true)
                .text(d => d.addr)
            ),
        update => update
            .attr("opacity", d => d.sender === true ? 1 : 0.3),
        exit => exit.remove()
    )

    //create links
    let linkGroup = diagram.linkGroup.selectAll(".link-group").data(links, d => d.id)
    linkGroup.join(
        enter => enter.append("g")
            .classed("link-group", true)
            .call(enter => enter.append("line")
                .attr("class", d => {
                    let src = d.source.id ? d.source.id : d.source;
                    let dst = d.target.id ? d.target.id : d.target;
                    return data.lookup.get(src).addr_type === "eth" && data.lookup.get(dst).addr_type === "ip" ? "link iface" : "link coms"
                })
                .attr("stroke-width", 1) //new link based on one comm, hence 1 width
                .call(doPulse)
                .append("title").text(1)
            )
            .call(enter => enter.append("text")
                .classed("label", true)
            ),
        update => update.select(".link")
            .attr("stroke-width", d => linkWidthScale(d.count))
            .filter(d => diagram.pulse.includes(d.id)) //select links with updated counter
            .call(doPulse)
            .select("title").text(d => d.count),
        exit => exit.remove()
    )

    //lower link opacity for one-direction links
    linkGroup.filter(d => d.target.sender === false)
        .attr("opacity", 0.3)

    //restart simulation if new nodes or links were added
    if (nodeGroup.size() != diagram.prevNodeCount || linkGroup.size != diagram.prevLinkCount) {
        diagram.simulation.nodes(nodes);
        diagram.simulation.force("link").links(links);
        diagram.simulation.alpha(1).restart();
        diagram.prevNodeCount = nodeGroup.size();
        diagram.prevLinkCount = linkGroup.size();
    }

    //reset pulse array
    diagram.pulse = []

    function doPulse(linkSelection) {
        linkSelection.each(function() {
            let startWidth = d3.select(this).style("stroke-width"), pulseDuration = 1000;

            d3.select(this)
                .style("stroke-width", startWidth+3)
                .style("stroke", "red")
                .transition()
                .duration(pulseDuration)
                .ease(d3.easePolyIn.exponent(3))
                .style("stroke-width", startWidth)
                .style("stroke", "grey");

            d3.selectAll(".node")
                .filter(d => d.id == this.__data__.source.id || d.id == this.__data__.target.id) //include source and target nodes
                .style("stroke", "red")
                .transition()
                .duration(pulseDuration)
                .ease(d3.easePolyIn.exponent(3))
                .style("stroke", "black");
        });
    }
}

export function center() {
    diagram.dimensions = diagram.svg.node().getBoundingClientRect();
    diagram.simulation.force("center", d3.forceCenter(diagram.dimensions.width/2, diagram.dimensions.height/2));
    diagram.simulation.alpha(1).restart();
}

function getLinkScale(links) {
    let minCount = Math.min(...(links.map(d => d.count))),
        maxCount = Math.max(...(links.map(d => d.count)));
    return d3.scaleLinear()
        .domain([minCount,maxCount])
        .range([1,5]);
}

function filterLinks(nodesArray, linksArray) {
    let nodeIds = nodesArray.map(d => d.id),
        links = [];

    linksArray.forEach(d => {
        let addr = d.id.split("-");
        if (nodeIds.includes(addr[0]) && nodeIds.includes(addr[1])) {
            links.push(d);
        }
    })

    if (nodesArray.map(d => d.addr_type).includes("eth")) {//filter ip->ip links if eth type nodes in diagram
        links = links.filter(d => d.type != "ip");
    }

    return links
}