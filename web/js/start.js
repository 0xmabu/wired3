const diagram = {
    svg: null,
    svgNodes: null,
    prevNodeCount: 0,
    svgLinks: null,
    prevLinkCount: 0,
    simulation: null,
    pulse: []
};
const data = {
    nodes: {eth: [], ip: [], all: []},
    links: {eth: [], ip: [], all: []},
    raw: [],
    lookup: new Map()
};
const counter = {
    batch: 10,
    events: 0
};
var eventSource;

window.addEventListener("DOMContentLoaded", function() {
    //create static aspects of the diagram and store needed values in diagram object
    initializeDiagram(); 

    //add event listeners
    this.addEventListener("resize", centerDiagramOnResize);
    document.getElementById("header-listener").addEventListener("click", toggleSSEListener);
    document.getElementById("header-options").addEventListener("click", toggleOptionsMenu);
    document.querySelectorAll("#options > * input,select").forEach(function(d) {
        d.addEventListener("change", updateDiagram);
    });
});

function initializeDiagram() {
    //create selections
    diagram.svg = d3.select("svg");
    const svgGroup = diagram.svg.append("g");
    diagram.svgLinks = svgGroup.append("g");
    diagram.svgNodes = svgGroup.append("g");
    
    //set up and configure simulation
    diagram.simulation = d3.forceSimulation()
        .force("center", d3.forceCenter(diagram.svg.node().width.baseVal.value/2, diagram.svg.node().height.baseVal.value/2)) //nodes center around point
        .force("charge", d3.forceManyBody().strength(-50)) //nodes attract or repell
        .force("collide", d3.forceCollide(15)) //area around node to prevent overlap
        .force("link", d3.forceLink().id(d => d.id).distance(45)) //length (and potential strength) of links
        .on("tick", ticked);
    
    function ticked() {
        diagram.svgLinks.selectAll(".link")
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        diagram.svgNodes.selectAll(".node-group")
            .attr("transform", d => `translate(${d.x} ${d.y})`);
    }

    //set up and configure zoom
    const zoom = d3.zoom()
        .scaleExtent([0.5, 32])
        .on("zoom", zoomed);

    diagram.svg.call(zoom);

    function zoomed(event) {
        svgGroup.attr("transform", event.transform);
    }
}

function centerDiagramOnResize() {
    diagram.simulation.force("center", d3.forceCenter(diagram.svg.node().width.baseVal.value/2, diagram.svg.node().height.baseVal.value/2));
    diagram.simulation.alpha(1).restart();
}

function toggleSSEListener() {
    if (this.innerText === "▶") {
        toggleSSE("on");
        this.innerText = "◼︎";
        this.title = "Stop data listener";
    } else {
        toggleSSE("off");
        this.innerText = "▶";
        this.title = "Start data listener";
    }
}

function handleVisibilityChange (eventSource) {
    if (document.visibilityState === "hidden") {
        eventSource.close();
    } else {
        eventSource = new EventSource("/data");
        eventSource.onmessage = parseData;
    }
}

function toggleSSE(mode) {
    if (mode === "on") {
        eventSource = new EventSource("/data");
        eventSource.onmessage = parseData;
        document.addEventListener("visibilitychange", function() {
            handleVisibilityChange(eventSource);
        });
    } else {
        eventSource.close();
        document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
}

function toggleOptionsMenu() {
    document.getElementById("options").classList.toggle("hidden");
}

function parseData(event) {
    let dataObj = JSON.parse(event.data);
    addToDataArray(dataObj);
    data.raw.push(dataObj);
    counter.events++;

    updateStatsTable();

    if (counter.events >= counter.batch) { //update diagram once we collected a batch of 10 data events
        updateDiagram();
        counter.events = 0;
    }
}

function addToDataArray(dataObj) {

    function addData(dataObj, target) {
        //set data props to be parsed (src or dst)
        if (target === "src") {
            var mac = dataObj.src_mac, vendor = dataObj.src_mac_vendor, ip = dataObj.src_ip;
        } else {
            var mac = dataObj.dst_mac, vendor = dataObj.dst_mac_vendor, ip = dataObj.dst_ip;
        }

        //add eth node
        var macKey = mac;

        if (data.lookup.has(macKey) === false) {
            var macObj = {
                id: macKey,
                addr: mac,
                addr_type: "eth",
                vendor: vendor,
                cast_type: getAddrCastType(dataObj, target, "mac"),
                assoc_ip: [],
                src: target === 'src' ? true : false,
                dst: target === 'dst' ? true : false,
                expanded: false
            };

            data.lookup.set(macKey, macObj); //node lookup table
            data.nodes.eth.push(macObj);
            data.nodes.all.push(macObj);
        } else {
            var macObj = data.lookup.get(macKey);

            if (target === 'src' && macObj.src === false) {
                macObj.src = true;
            } else if (target === 'dst' && macObj.dst === false) {
                macObj.dst = true;
            }
        }

        if (ip != undefined) {
            //add ip node
            var ipKey = `${mac},${ip}`;

            if (data.lookup.has(ipKey) == false) {
                var ipObj = {
                    id: ipKey,
                    addr: dataObj.ip_ver === 6 ? shortenIpv6(ip) : ip,
                    addr_type: dataObj.ip_ver === 4 ? "ipv4" : "ipv6",
                    ip_ver: dataObj.ip_ver,
                    cast_type: getAddrCastType(dataObj, target, "ip"),
                    assoc_eth: [macObj],
                    src: target === 'src' ? true : false,
                    dst: target === 'dst' ? true : false
                };

                data.lookup.set(ipKey, ipObj); //node lookup table
                data.nodes.ip.push(ipObj);
                data.nodes.all.push(ipObj);
                macObj.assoc_ip.push(ipObj);
            } else {
                var ipObj = data.lookup.get(ipKey);

                if (target === 'src' && ipObj.src === false) {
                    ipObj.src = true;
                } else if (target === 'dst' && ipObj.dst === false) {
                    ipObj.dst = true;
                }
            }

            //add eth->ip (iface) link
            var linkKey = `${macKey}-${ipKey}`;
            diagram.pulse.push(linkKey);

            if (data.lookup.has(linkKey) == false) {
                var linkObj = {
                    id: linkKey,
                    source: macKey,
                    target: ipKey,
                    count: 1
                };

                data.lookup.set(linkKey, linkObj); //node lookup table
                data.links.all.push(linkObj);
            }
        }

        if (target === "src") { //only add com links for source props
            //add eth coms link
            var linkKey = `${macKey}-${dataObj.dst_mac}`;
            diagram.pulse.push(linkKey);

            if (data.lookup.has(linkKey) == false) {
                var linkObj = {
                    id: linkKey,
                    source: macKey,
                    target: dataObj.dst_mac,
                    count: 1
                };

                data.lookup.set(linkKey, linkObj); //node lookup table
                data.links.eth.push(linkObj);
                data.links.all.push(linkObj);
            } else {
                data.lookup.get(linkKey).count++;
            }

            //add ip coms link
            if (dataObj.src_ip != undefined) {
                var linkKey = `${ipKey}-${`${dataObj.dst_mac},${dataObj.dst_ip}`}`;
                diagram.pulse.push(linkKey);

                if (data.lookup.has(linkKey) == false) {
                    var linkObj = {
                        id: linkKey,
                        source: ipKey,
                        target: `${dataObj.dst_mac},${dataObj.dst_ip}`,
                        count: 1
                    };

                    data.lookup.set(linkKey, linkObj); //node lookup table
                    data.links.ip.push(linkObj);
                } else {
                    data.lookup.get(linkKey).count++;
                }
            }
        }
    }

    addData(dataObj, "src")
    addData(dataObj, "dst")
}

function updateStatsTable() {
    const statsTr = document.querySelectorAll("#stats-table td");
    statsTr[1].innerText = data.raw.length;
    statsTr[3].innerText = data.nodes.eth.length;
    statsTr[5].innerText = data.nodes.ip.length;
}

function updateDiagram() {
    //get data
    let nodes = filterNodes(data.nodes.all)
    let links = filterLinks(nodes, data.links.all)
    let linkWidthScale = getLinkScale(links);
    
    //create nodes
    let nodeGroup = diagram.svgNodes.selectAll(".node-group").data(nodes, d => d.id);
    nodeGroup.join(
        enter => enter.append("g")
            .classed("node-group", true)
            .attr("opacity", d => d.src === true ? 1 : 0.3)
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
            .attr("opacity", d => d.src === true ? 1 : 0.3),
        exit => exit.remove()
    )

    //create links
    let linkGroup = diagram.svgLinks.selectAll(".link-group").data(links, d => d.id)
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
    linkGroup.filter(d => d.target.src === false)
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
                .style("stroke-width", 3)
                .style("stroke", "red")
                .transition()
                .duration(pulseDuration)
                .ease(d3.easePolyIn.exponent(3))
                .style("stroke-width", 1)
                .style("stroke", "black");
        });
    }
}

function filterNodes(nodesArray) {
    const nodeTypes = d3.selectAll("#options-nodes > input[type=checkbox]:checked").nodes().map(d => d.name)
    let nodes = nodesArray.filter(d => nodeTypes.includes(d.addr_type));
    //below needs to be fixed to support multiple assoc_eth...
    //nodes = nodes.filter(d => d.addr_type == "eth" || (d.addr_type == "ip" && d.assoc_eth[0].expanded == true));
    return nodes;
}

function filterLinks(nodesArray, linksArray) {
    return linksArray.filter((d) => {
        let addr = d.id.split("-");
        if (nodesArray.find(d => addr[0] == d.id) && nodesArray.find(d => addr[1] == d.id)) {
            return true
        } else {
            return false
        }
    });
}

function getLinkScale(links) {
    let minCount = Math.min(...(links.map(d => d.count))),
        maxCount = Math.max(...(links.map(d => d.count)));
    return d3.scaleLinear()
        .domain([minCount,maxCount])
        .range([1,5]);
}

function getAddrCastType(addrData, node, proto) {
    if (node == "src") { //src
        var mac = addrData.src_mac, ip = addrData.src_ip;
    } else { //dst
        var mac = addrData.dst_mac, ip = addrData.dst_ip;
    }

    if (proto == "eth") { //eth
        if (mac == "ff:ff:ff:ff:ff:ff") {
            return "bcast";
        } else if (mac.match("^01:00:5e") /*ipv4 mcast*/ || mac.match("^33:33:") /*ipv6 mcast*/) {
            return "mcast";
        } else {
            return "ucast";
        }
    } else { //ip
        if (mac == "ff:ff:ff:ff:ff:ff") {
            return "bcast";
        } else if (ip.match("^(?:22[4-9]|23[0-9])\.") /*ipv4 mcast*/ || ip.match("^ff") /*ipv6 mcast*/) {
            return "mcast";
        } else {
            return "ucast";
        }
    }
}

function shortenIpv6(addr) {
    return addr.replace(/\b(?:0+:){2,}/, ':');
}

function showDetails() {
    const detailsDiv = document.getElementById("details"),
        infoTable = document.querySelector("#node-info"),
        infoData = infoTable.querySelectorAll("td"),
        comsTable = document.querySelector("#node-coms"),
        nodeId = this.__data__.id,
        nodeType = Object.keys(this.__data__).includes("assoc_ip") ? "eth" : "ip";

    infoTable.innerHTML = "";
    comsTable.innerHTML = "";

    if (infoData.length > 0 && infoData[1].innerText === this.__data__.addr_type && infoData[3].innerText === this.__data__.addr) { //hide details div if same node is clicked again
        detailsDiv.style.display = "none";
    } else {
        //node info table
        infoTable.innerHTML = "";
        var row = infoTable.insertRow(0);
        row.insertCell(0).textContent = "Type:";
        row.insertCell(1).textContent =  this.__data__.addr_type;
        var row = infoTable.insertRow(1);
        row.insertCell(0).textContent = "Address:";
        row.insertCell(1).textContent =  this.__data__.addr;

        if (nodeType === "eth") {
            var row = infoTable.insertRow(2);
            row.insertCell(0).textContent = "Vendor:";
            row.insertCell(1).textContent = this.__data__.vendor;
            var row = infoTable.insertRow(3);
            row.insertCell(0).textContent = "Associated:";
            row.insertCell(1).innerHTML =  this.__data__.assoc_ip.map(d => d.addr).join("<br>");
        } else { //ipv4,ipv6
            var row = infoTable.insertRow(2);
            row.insertCell(0).textContent = "DNSName:";
            row.insertCell(1).textContent = "";
            var row = infoTable.insertRow(3);
            row.insertCell(0).textContent = "Associated:";
            row.insertCell(1).innerHTML =  this.__data__.assoc_eth.map(d => d.addr).join("<br>");
        }

        //node coms table
        const thead = comsTable.createTHead();
        const tbody = comsTable.createTBody();

        //populate thead
        let hRow = thead.insertRow(0);
        hRow.insertCell(0).textContent = "Flow";
        hRow.insertCell(1).textContent = "Remote";

        if (nodeType == "eth") {
            hRow.insertCell(2).textContent = "EthType";
            hRow.insertCell(3).textContent = "Time";
        } else {
            hRow.insertCell(2).textContent = "Proto";
            hRow.insertCell(3).textContent = "Port";
            hRow.insertCell(4).textContent = "Time";
        }

        for (let row of data.raw) {
            let timestamp = (new Date(row.timestamp * 1000)).toISOString();
            timestamp = timestamp.split("T")[1].slice(0,-1)

            if (nodeType === "eth") {
                let srcId = row.src_mac, dstId = row.dst_mac;

                if (nodeId === srcId || nodeId === dstId) {
                    let dRow = tbody.insertRow(0);
                    dRow.insertCell(0).textContent = nodeId === srcId ? "-->" : "<--"; //flow
                    dRow.insertCell(1).textContent = nodeId === srcId ? row.dst_mac : row.src_mac; //remote
                    dRow.insertCell(2).textContent = getEthType(row.eth_type); //type
                    dRow.insertCell(3).textContent = timestamp; //time
                }
            } else { //nodeType "ip"
                let srcId = `${row.src_mac},${row.src_ip}`, dstId = `${row.dst_mac},${row.dst_ip}`;

                if (nodeId === srcId || nodeId === dstId) {
                    let dRow = tbody.insertRow(0);
                    dRow.insertCell(0).textContent = nodeId === srcId ? "-->" : "<--"; //flow

                    let ipAddrCell = dRow.insertCell(1);
                    ipAddrCell.textContent = nodeId === srcId ? row.dst_ip : row.src_ip; //remote
                    if (row.ip_ver === 6) {
                        ipAddrCell.textContent = shortenIpv6(ipAddrCell.textContent);
                    }

                    dRow.insertCell(2).textContent = getIpProtocol(row.ip_proto); //proto
                    dRow.insertCell(3).textContent = nodeId === srcId ? row.dst_port : row.src_port; //port
                    dRow.insertCell(4).textContent = timestamp; //time
                }
            }
        }

        detailsDiv.style.display = "";
    }
}

function getEthType(ethType) {
    switch (ethType) {
        case 2048: return "IPv4"
        case 2054: return "ARP";
        case 34525: return "IPv6";
        default: return proto;
    }
}

function getIpProtocol(proto) {
    switch (proto) {
        case 1: return "ICMP";
        case 6: return "TCP";
        case 17: return "UDP";
        case 255: return "";
        default: return proto;
    }
}
