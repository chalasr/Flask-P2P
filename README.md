# Flask OTR WebRTC Demo

This project demonstrates how to implement [Off The Record](http://en.wikipedia.org/wiki/Off-the-Record_Messaging) [WebRTC](http://www.webrtc.org/) chat with [Flask](http://flask.pocoo.org/).

Motivations behind project:
 - Create simple example to experiment with
 - Experiment with WebRTC
 - Experiment with OTR
 - Experiment with Flask + SSE
 - Use [SSE](https://developer.mozilla.org/en-US/docs/Server-sent_events/Using_server-sent_events) and not WebSockets as part of the intermediary

# Installation

    git clone https://github.com/spectralsun/flask-otr-webrtc-demo.git
    cd flask-otr-webrtc-demo
    virtualenv venv
    source venv/bin/activate
    pip install -r requirements.txt

Then run the development server with:

    python app.py

Now you should be able to visit [http://localhost:5000](http://localhost:5000) in your browser.

# Restarting the development server

Since this app runs multithreaded and has open streaming connections, you may find it difficult to reload python changes dynamically while the server is running. You will have to kill all the related python processes if you want to restart the development server.

I recommend using the following one-liner command to kill all running instances after you use Ctrl+C to stop `python app.py`. It will grep the running processes and look for `app.py`, end all instances and then start the server back up:

    for pid in `ps aux |grep app\.py|grep -v grep|awk '{print $2}'`; do; kill -9 $pid; done; python app.py;

