from bottle import Bottle, debug, response, run, static_file, WaitressServer
from config import WEB_ROOT
from queue import Empty
import json
import os

app = Bottle()

@app.route('/')
def start():
    return static_file('start.html', root=WEB_ROOT)

@app.route('/data')
def data():
    response.content_type = 'text/event-stream'
    response.cache_control = 'no-cache'
    
    while True: #replace with some client state checking logics...
        try:
            data = app.data_queue.get(timeout=1)
            yield f"data: {json.dumps(data)}\n\n"
        except Empty:
            continue
        except Exception as e:
            print("Error sending data", e)
            break

@app.route('/<folder>/<file>')
def static(folder, file):
    static_path = os.path.join(WEB_ROOT, folder)
    return static_file(file, root=static_path)
                       
def run_app(data_queue):
    app.data_queue = data_queue
    debug(True) #remove from prod
    run(app, server=WaitressServer, host='localhost', port=8080)
