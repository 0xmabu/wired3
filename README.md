# About
A tool to visualize hosts and communications on the local network.

The application starts a packet capture on a user-selected network adapter, and forwards the data to a web server that streams incoming packets as json objects over to the client. The client (a web browser with javascript enabled) visualizes the incoming data as a network diagram of Ethernet and IP nodes. The diagram allows panning and zooming, and shows a detailed data view when a node is clicked.

The server application is written in python and requires the cypcap library (https://pypi.org/project/cypcap) to be installed. The client application is JavaScript and uses the D3.js library (https://d3js.org) for visualization.

# Running the application
To start the server, run: python app.py.
NOTE: The application may need sudo/admin privileges in order to start packet captures on the selected network adapter.

Access the web application on: http://127.0.0.1:8000/start.html 
NOTE: You can start/stop the client data listener by pressing the button in the top right corner.
