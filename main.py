import app_server
import packet_processor
from cypcap import findalldevs

def select_pcap_iface():
    ifaces = findalldevs()
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

def filter_capture():
    while True:
        choice = input("Filter traffic to/from capture interface (y/n)?")
        if choice == "y":
            return True
        elif choice == "n":
            return False
        else:
            print("Invalid input")

if __name__ == '__main__':
    iface = select_pcap_iface()
    filter_capture_iface = filter_capture()
    packet_thread = packet_processor.PacketProcessor(iface, filter_capture_iface)
    packet_thread.start()
    app_server.run_app(packet_thread.queue)
