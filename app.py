from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse
from queue import Queue
import threading
import time
import json
import os
import cypcap
import struct
import csv

current_dir = os.path.dirname(os.path.abspath(__file__))
web_root = os.path.join(current_dir, 'web')
web_data = os.path.join(web_root, 'data')

os.chdir(web_root)

class PacketCapture(threading.Thread):
    def __init__(self, iface, queue):
        super().__init__()
        self.interface = iface
        self.queue = queue
    
    def run(self):
        with cypcap.create(self.interface) as pcap:
            pcap.set_snaplen(65536)
            pcap.set_promisc(True)
            pcap.set_timeout(1000)
            pcap.activate()

            print(f"Capturing packets on interface [{self.interface.description}]")

            for pkthdr, data in pcap:
                if pkthdr is None:
                    continue

                eth_fields = struct.unpack("!6s6sH", data[:14])

                pkt_obj = {
                    "timestamp": pkthdr.ts,
                    "src_mac": self.hex_to_mac(eth_fields[1]),
                    "dst_mac": self.hex_to_mac(eth_fields[0]),
                    "eth_type": eth_fields[2]
                }

                pkt_obj["src_mac_vendor"] = mac_lookup.get(pkt_obj["src_mac"][0:8])
                pkt_obj["dst_mac_vendor"] = mac_lookup.get(pkt_obj["dst_mac"][0:8])

                if eth_fields[2] == 0x0800: #ipv4
                    ip_fields = struct.unpack("BBHHHBBH4s4s", data[14:34])
                    pkt_obj["ip_ver"] = 4
                    pkt_obj["src_ip"] = self.hex_to_ipv4(ip_fields[8])
                    pkt_obj["dst_ip"] = self.hex_to_ipv4(ip_fields[9])
                    self.parse_transport_layer(pkt_obj, ip_fields[6], data, 34)
                
                elif eth_fields[2] == 0x86DD: #ipv6
                    ipv6_fields = struct.unpack("!4sHBB16s16s", data[14:54])
                    pkt_obj["ip_ver"] = 6
                    pkt_obj["src_ip"] = self.hex_to_ipv6(ipv6_fields[4])
                    pkt_obj["dst_ip"] = self.hex_to_ipv6(ipv6_fields[5])
                    next_header = ipv6_fields[2]
                    payload_offset = 54

                    #check for extension headers and determine actual payload offset 
                    while next_header in [0, 43, 44, 50, 51, 60]:  # hop-by-hop, routing, fragment, ah, esp, destination options
                        ext_header_length = (data[payload_offset + 1] + 1) * 8
                        next_header = data[payload_offset]
                        payload_offset += ext_header_length

                    self.parse_transport_layer(pkt_obj, next_header, data, payload_offset)

                self.queue.put(pkt_obj)
    
    def parse_transport_layer(self, pkt_obj, proto, data, offset):
        if proto == 6:  # tcp
            tcp_fields = struct.unpack("!HHIIBBHHH", data[offset:offset + 20])
            pkt_obj["ip_proto"] = 6
            pkt_obj["src_port"] = tcp_fields[0]
            pkt_obj["dst_port"] = tcp_fields[1]
        elif proto == 17:  # udp
            udp_fields = struct.unpack("!HHHH", data[offset:offset + 8])
            pkt_obj["ip_proto"] = 17
            pkt_obj["src_port"] = udp_fields[0]
            pkt_obj["dst_port"] = udp_fields[1]
        else:
            pkt_obj["ip_proto"] = proto

    @staticmethod
    def hex_to_mac(bin_hex):
        hex_str = bin_hex.hex()
        return ":".join(hex_str[i:i + 2] for i in range(0, len(hex_str), 2))

    @staticmethod
    def hex_to_ipv4(bin_hex):
        return ".".join(str(byte) for byte in bin_hex)
    
    @staticmethod
    def hex_to_ipv6(bin_hex):
        hex_str = bin_hex.hex()
        return ":".join(hex_str[i:i + 4] for i in range(0, len(hex_str), 4))

class WebRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urlparse(self.path)
        file_path = parsed_path.path.strip("/")
    
        if os.path.exists(file_path) and os.path.isfile(file_path):
            #requested file
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            with open(file_path, 'rb') as file:
                self.wfile.write(file.read())

        elif self.path == '/data':
            #sse logics
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.end_headers()

            while True:
                try:
                    data = data_queue.get(timeout=1)
                    self.wfile.write(f"data: {json.dumps(data)}\n\n".encode())
                    self.wfile.flush()
                except Exception as e:
                    if type(e).__name__ == 'Empty':
                        pass
                    else:
                        print("Error sending data", e)
                        break
                    
        else:
            #not found
            self.send_response(400)
            self.send_header('Content-type', 'text/html')
            self.end_headers()

def run_webserver(server_class=HTTPServer, handler_class=WebRequestHandler, address='127.0.0.1', port=8000):
    httpd = server_class((address, port), handler_class)
    print(f"Web server running on {address}:{port}")
    httpd.serve_forever()

def select_pcap_iface():
    ifaces = cypcap.findalldevs()
    options = [i.description for i in ifaces]
    print("Select capture interface:")
    for index, item in enumerate(options, start=1):
        print(f"{index}. {item}")

    while True:
        try:
            choice = int(input("Select interface index: "))
            if 1 <= choice <= len(ifaces):
                return ifaces[choice - 1]
            else:
                print("Invalid input")
        except ValueError:
            print("Invalid input")

def import_mac_data():
    with open(os.path.join(web_data, 'oui.csv'), encoding="utf8") as file:
        csv_reader = csv.reader(file, delimiter=',')
        lookup_table = {}
        for row in csv_reader:
            mac_str =  ":".join(row[1][i:i + 2] for i in range(0, len(row[1]), 2)).lower()
            lookup_table[mac_str] = row[2]

        return lookup_table

def delete_queue_items(queue, max_age):
    while True:
        current_time = time.time()
        while not queue.empty():
            item = queue.queue[0]
            timestamp = item["timestamp"]
            if current_time - timestamp > max_age:
                queue.get()
            else:
                break
        time.sleep(1)

if __name__ == '__main__':
    data_queue = Queue()
    mac_lookup = import_mac_data()
    iface = select_pcap_iface()
    capture_thread = PacketCapture(iface, data_queue)
    capture_thread.start()

    delete_thread = threading.Thread(target=delete_queue_items, args=(data_queue, 60))
    delete_thread.daemon = True
    delete_thread.start()

    run_webserver()
