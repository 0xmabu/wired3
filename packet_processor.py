import threading
import cypcap
import struct
import time
import os
import csv
from queue import Queue
from getmac import get_mac_address
from config import WEB_FILES

class PacketProcessor(threading.Thread):
    def __init__(self, iface, filter_cap_iface):
        super().__init__()
        self.interface = iface
        self.queue = Queue()
        self.filter_cap_iface = filter_cap_iface
        self.mac_lookup = import_mac_data()

    def run(self):
        with cypcap.create(self.interface) as pcap:
            pcap.set_snaplen(65536)
            pcap.set_promisc(True)
            pcap.set_immediate_mode(True)
            pcap.activate()

            if self.filter_cap_iface:
                ip_addr = self.interface.addresses[0].addr[1][0] #first ip addr on interface
                mac_addr = get_mac_address(ip=ip_addr)
                pcap.setfilter("not ether src {} and not ether dst {}".format(mac_addr,mac_addr))

            print(f"Capturing packets on interface [{self.interface.description}]")

            for pkthdr, data in pcap:
                if pkthdr is None:
                    continue

                #remove any events on queue older than 5 sec
                self.trim_queue(5)

                eth_fields = struct.unpack("!6s6sH", data[:14])

                pkt_obj = {
                    "timestamp": pkthdr.ts,
                    "src_mac": self.hex_to_mac(eth_fields[1]),
                    "dst_mac": self.hex_to_mac(eth_fields[0]),
                    "eth_type": eth_fields[2]
                }

                pkt_obj["src_mac_vendor"] = self.mac_lookup.get(pkt_obj["src_mac"][0:8])
                pkt_obj["dst_mac_vendor"] = self.mac_lookup.get(pkt_obj["dst_mac"][0:8])

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

    def trim_queue(self, max_age):
        current_time = time.time()
        while not self.queue.empty() and current_time - self.queue.queue[0]["timestamp"] > max_age:
            self.queue.get()

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

def import_mac_data():
    with open(os.path.join(WEB_FILES, 'oui.csv'), encoding="utf8") as file:
        csv_reader = csv.reader(file, delimiter=',')
        lookup_table = {}
        for row in csv_reader:
            mac_str =  ":".join(row[1][i:i + 2] for i in range(0, len(row[1]), 2)).lower()
            lookup_table[mac_str] = row[2]
        return lookup_table