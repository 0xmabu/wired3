const diagram = {
    type: "radial-tree",
    module: null,
    svg: null,
    svgGroup: null,
    nodeGroup: null,
    linkGroup: null,
    dimensions: null,
    simulation: null,
    tree: null,
    pulse: [],
    prevNodeCount: 0,
    prevLinkCount: 0
};
const data = {
    nodes: [],
    links: [],
    raw: [],
    lookup: new Map()
};
const counters = {
    events: 0
};
const modules = {}, eventBatchSize = 10;
var eventSource, diagramChangeHandler, interval;

class Node {
    constructor(id, target) {
        this.id = id;
        this.sender = target === "src" ? true : false;
        this.receiver = target === "dst" ? true : false;
    }
}
class EthNode extends Node {
    constructor(id, target, addr, vendor) {
        super(id, target);
        this.addr = addr;
        this.addr_type = "eth";
        this.vendor = vendor;
        this.assoc_ip = [];
        this.cast_type = PacketUtil.getEthAddrCastType(addr);
    }

    associateIp(ipNode) {
        if (!this.assoc_ip.includes(ipNode)) this.assoc_ip.push(ipNode);
    }
}
class IPNode extends Node {
    constructor(id, target, ip, ip_ver, mac) {
        super(id, target);
        this.addr = ip_ver === 6 ? PacketUtil.shortenIpv6(ip) : ip;
        this.addr_type = ip_ver === 6 ? "ipv6" : "ipv4";
        this.assoc_eth = [];
        this.cast_type = PacketUtil.getIpAddrCastType(ip, mac);
    }

    associateEth(ethObj) {
        if (!this.assoc_eth.includes(ethObj)) this.assoc_eth.push(ethObj);
    }
}
class NodeLink {
    constructor(id, source, target, type) {
        this.id = id;
        this.source = source;
        this.target = target;
        this.counter = 1;
        this.type = type;
    }
    increment() {
        this.counter++;
    }
}
class PacketUtil {
    static getEthAddrCastType(mac) {
        if (mac === "ff:ff:ff:ff:ff:ff") {
            return "bcast";
        } else if (mac.match("^01:00:5e") /*ipv4 mcast*/ || mac.match("^33:33:") /*ipv6 mcast*/) {
            return "mcast";
        } else {
            return "ucast";
        }
    }

    static getIpAddrCastType(ip, mac) {
        if (mac === "ff:ff:ff:ff:ff:ff") {
            return "bcast";
        } else if (ip.match("^(?:22[4-9]|23[0-9])\.") /*ipv4 mcast*/ || ip.match("^ff") /*ipv6 mcast*/) {
            return "mcast";
        } else {
            return "ucast";
        }
    }

    static getEthType(type) {
        switch (type) {
            case 2048: return "IPv4";
            case 2054: return "ARP";
            case 34525: return "IPv6";
            default: return type;
        }
    }

    static shortenIpv6(addr) { //to be fixed
        return addr.replace(/\b(?:0+:){2,}/, ":");//replaceAll("((?::0\\b){2,}):?(?!\\S*\\b\\1:0\\b)(\\S*)", "::$2").replaceFirst("^0::","::")
    }

    static getIpProtocol(proto) {
        switch (proto) {
            case 1: return "ICMP";
            case 6: return "TCP";
            case 17: return "UDP";
            case 58: return "IPv6-ICMP"
            case 255: return "";
            default: return proto;
        }
    }
}

window.addEventListener("DOMContentLoaded", async function() {
    //load modules
    modules.network = await import("./network.js");
    modules.radialTree = await import("./radial-tree.js");

    //initialize shared diagram stuff
    initializeDiagram();

    //add generic event listeners
    document.getElementById("header-listener").addEventListener("click", function () {
        if (this.innerText === "▶") {
            toggleSSE("on");
            this.innerText = "◼︎";
            this.title = "Stop listener";
        } else {
            toggleSSE("off");
            this.innerText = "▶";
            this.title = "Start listener";
        }
        updateStatsTable();
    });
    document.getElementById("header-options").addEventListener("click", function () {
        document.getElementById("options").classList.toggle("hidden");
    });
});

function initializeDiagram() {
    //reset diagram div
    const diagramDiv = d3.select("#diagram");
    diagramDiv.node().innerHTML = "";

    //create global diagram variables
    diagram.svg = diagramDiv.append("svg");
    diagram.svgGroup = diagram.svg.append("g");
    diagram.linkGroup = diagram.svgGroup.append("g");
    diagram.nodeGroup = diagram.svgGroup.append("g");
    diagram.dimensions = diagram.svg.node().getBoundingClientRect()

    //initialize zoom
    const zoom = d3.zoom()
        .scaleExtent([0.5, 32])
        .on("zoom", function (event) {
            diagram.svgGroup.attr("transform", event.transform);
        });
    diagram.svg.call(zoom);

    //remove existing diagram-specific event handlers if any
    if (diagram.module) {
        window.removeEventListener("resize", diagram.module.center);
        document.getElementById("diagram-select").removeEventListener("change", diagramChangeHandler);
        document.querySelectorAll("#options > * input").forEach(function(d) {
            d.removeEventListener("change", diagram.module.update);
        });
    }

    //bind diagram-specific functions
    if (diagram.type === "network") {
        diagram.module = modules.network;
    } else if (diagram.type === "radial-tree") {
        diagram.module = modules.radialTree;
    }

    //initialize new diagram, passing zoom to allow diagram-specific config (initial zoom transition)
    diagram.module.init(zoom);

    //define diagram change handler function
    diagramChangeHandler = function() {
        const listenerActive = eventSource === undefined || eventSource.readyState === 2 ? false : true;
        if (diagram.type === "network") diagram.simulation.stop();

        if (listenerActive) toggleSSE("off");
        diagram.type = this.value;
        initializeDiagram();
        diagram.module.update();
        if (listenerActive) toggleSSE("on");
    }

    //add diagram-specific event handlers
    window.addEventListener("resize", diagram.module.center);
    document.getElementById("diagram-select").addEventListener("change", diagramChangeHandler);
    document.querySelectorAll("#options > * input").forEach(function(d) {
        d.addEventListener("change", diagram.module.update);
    });
}

function toggleSSE(mode) {
    const changeHandler = function() {
        if (document.visibilityState === "hidden") {
            document.getElementById("header-listener").click();
        } else {/*potentially some "want to start listener?" promt*/}
    }

    if (mode === "on") {
        eventSource = new EventSource("/data");
        eventSource.onmessage = processEvent;
        document.addEventListener("visibilitychange", changeHandler);

        interval = d3.interval(d => {
            if (counters.events > 0) {
                counters.events = 0;
                diagram.module.update();
            }
        }, 100); //100 ms interval
    } else {
        if (eventSource != undefined) {
            interval.stop();
            eventSource.close();
            document.removeEventListener("visibilitychange", changeHandler);
        }
    }
}

function processEvent(event) {
    counters.events++;
    let obj = JSON.parse(event.data);
    data.raw.push(obj);

    parseData(obj);
    updateStatsTable();

    /*if (counters.events >= eventBatchSize) { //update diagram once we collected a batch of 10 data events
        counters.events = 0;
        diagram.module.update();
    }*/
}

function parseData(dataObj) {
    for (let target of ["src","dst"]) {
        //set data props to be parsed (src or dst)
        if (target === "src") {
            var eth = dataObj.src_mac,
                vendor = dataObj.src_mac_vendor,
                ip = dataObj.src_ip;
        } else {
            var eth = dataObj.dst_mac,
                vendor = dataObj.dst_mac_vendor,
                ip = dataObj.dst_ip;
        }

        //add eth node
        var ethKey = eth;

        if (data.lookup.has(ethKey) === false) {
            var ethObj = new EthNode(ethKey, target, eth, vendor);
            data.lookup.set(ethKey, ethObj); //lookup table
            data.nodes.push(ethObj);
        } else {
            var ethObj = data.lookup.get(ethKey);

            if (target === "src" && ethObj.sender === false) {
                ethObj.sender = true;
            } else if (target === "dst" && ethObj.receiver === false) {
                ethObj.receiver = true;
            }
        }

        if (ip != undefined) {
            //add ip node
            var ipKey = `${eth},${ip}`;

            if (data.lookup.has(ipKey) === false) {
                var ipObj = new IPNode(ipKey, target, ip, dataObj.ip_ver, eth);
                ipObj.associateEth(ethObj);
                data.lookup.set(ipKey, ipObj); //lookup table
                data.nodes.push(ipObj);
                ethObj.associateIp(ipObj);
            } else {
                var ipObj = data.lookup.get(ipKey);

                if (target === "src" && ipObj.sender === false) {
                    ipObj.sender = true;
                } else if (target === "dst" && ipObj.receiver === false) {
                    ipObj.receiver = true;
                }
            }

            //add eth->ip (iface) link
            var linkKey = `${ethKey}-${ipKey}`;
            diagram.pulse.push(linkKey);

            if (data.lookup.has(linkKey) === false) {
                var linkObj = new NodeLink(linkKey, ethKey, ipKey, "eth-ip");
                data.lookup.set(linkKey, linkObj); //lookup table
                data.links.push(linkObj);
            }
        }

        if (target === "src") { //only add com links for data related to sender
            //add eth coms link
            var linkKey = `${ethKey}-${dataObj.dst_mac}`;
            diagram.pulse.push(linkKey);

            if (data.lookup.has(linkKey) === false) {
                var linkObj = new NodeLink(linkKey, ethKey, dataObj.dst_mac, "eth");
                data.lookup.set(linkKey, linkObj); //lookup table
                data.links.push(linkObj);
            } else {
                data.lookup.get(linkKey).increment();
            }

            //add ip coms link
            if (dataObj.src_ip != undefined) {
                var linkKey = `${ipKey}-${`${dataObj.dst_mac},${dataObj.dst_ip}`}`;
                diagram.pulse.push(linkKey);

                if (data.lookup.has(linkKey) == false) {
                    var linkObj = new NodeLink(linkKey, ipKey, `${dataObj.dst_mac},${dataObj.dst_ip}`, "ip");
                    data.lookup.set(linkKey, linkObj); //lookup table
                    data.links.push(linkObj);
                } else {
                    data.lookup.get(linkKey).increment();
                }
            }
        }
    }
}

function updateStatsTable() {
    const statsTr = document.querySelectorAll("#stats-table td");
    statsTr[1].innerText = eventSource.readyState === 2 ? "Stopped" : "Running";
    statsTr[1].style.color = statsTr[1].innerText === "Stopped" ? "orange" : "lime";
    statsTr[3].innerText = data.raw.length;
    statsTr[5].innerText = data.nodes.length;
}

function showDetails() {
    const detailsDiv = document.getElementById("details"),
        infoTable = document.querySelector("#node-info"),
        infoData = infoTable.querySelectorAll("td"),
        comsTable = document.querySelector("#node-coms"),
        nodeId = this.__data__.id,
        nodeType = this.__data__.addr_type === "eth" ? "eth" : "ip";

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
                    dRow.insertCell(2).textContent = PacketUtil.getEthType(row.eth_type); //type
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
                        ipAddrCell.textContent = PacketUtil.shortenIpv6(ipAddrCell.textContent);
                    }

                    dRow.insertCell(2).textContent = PacketUtil.getIpProtocol(row.ip_proto); //proto
                    dRow.insertCell(3).textContent = nodeId === srcId ? row.dst_port : row.src_port; //port
                    dRow.insertCell(4).textContent = timestamp; //time
                }
            }
        }

        detailsDiv.style.display = "";
    }
}

function filterNodes(nodesArray) {
    const nodeTypes = d3.selectAll("#options-nodes > input[type=checkbox]:checked").nodes().map(d => d.name)
    let nodes = nodesArray.filter(d => nodeTypes.includes(d.addr_type));
    //below needs to be fixed to support multiple assoc_eth...
    //nodes = nodes.filter(d => d.addr_type == "eth" || (d.addr_type == "ip" && d.assoc_eth[0].expanded == true));
    return nodes;
}