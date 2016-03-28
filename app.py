import datetime
import json
import thread
import time
import uuid
from Queue import Queue
from datetime import datetime

from flask import Flask, render_template, request, session, Response, \
    stream_with_context

app = Flask(__name__)
app.config['SECRET_KEY'] = 'asdf'
app.debug = True
heartbeat_interval = 10 # seconds

class ExtensibleJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if hasattr(obj, 'to_JSON'):
            return obj.to_JSON()
        return super(ExtensibleJSONEncoder, self).default(obj)

def jsonify(*args, **kwargs):
    indent = None
    status = kwargs.pop('_status', 200)
    mime = kwargs.pop('_mime', 'application/json')
    data = args[0] if args else dict(kwargs)

    if app.config['JSONIFY_PRETTYPRINT_REGULAR'] \
       and not request.is_xhr:
        indent = 2

    dump = json.dumps(data, indent=indent)
    return app.response_class(dump, status=status, mimetype=mime)



# Override Flask's json encoder to check for to_JSON method on objects
app.json_encoder = ExtensibleJSONEncoder

class WebRTCUser(object):
    id = None
    username = None
    connected_at = None
    namespace = None

    def __init__(self, id, username=None):
        self.id = id
        self.username = username
        self.connected_at = datetime.utcnow()
        self.rooms = []
        self.messages = Queue()

    def __repr__(self):
        return '<WebRTCUser %s %s>' % (self.id, self.username)

    def add_stream(self, stream_id):
        self.streams[stream_id] = dict(queue=Queue())

    def emit(self, event=None, **data):
        if event:
            data['event'] = event
        payload = data.pop('_payload', None)
        if not payload:
            payload = json.dumps(data)
        if payload != '{"event": "heartbeat"}':
            print 'Emitting %s to %s' % (payload, self)
        self.messages.put_nowait(payload)

    def emit_to_rooms(self, event, **data):
        for room in self.rooms:
            room.emit(event, **data)

    def to_JSON(self):
        return dict(
            id=self.id,
            username=self.username
        )

class WebRTCRoom(object):
    name = ''
    encryption = ''
    browser = ''
    browser_version = ''

    def __init__(self, name):
        self.name = name
        self.users = []

    def __repr__(self):
        return '<WebRTCRoom %s>' % self.name

    def user_join(self, user):
        print "User %s is joining %s" % (user, self.name)
        if user in self.users:
            return
        self.users.append(user)
        user.rooms.append(self)
        print user.id
        self.emit('user_join', _exclude=user.id,
            username=user.username,
            room=self.name)

    def user_leave(self, user, disconnect=True):
        try:
            self.users.remove(user)
            user.rooms.remove(self)
            self.emit('user_leave', _exclude=user.id,
                disconnect=disconnect,
                username=user.username)
        except:
            pass

    def emit(self, event, **data):
        data['event'] = event
        payload = json.dumps(data)
        exclude = data.pop('_exclude', None)
        print 'Room %s emitting %s to %s exlcuding %s' % \
            (self.name, payload, self.users, exclude)
        for user in self.users:
            if exclude and user.id == exclude:
                continue
            user.emit(_payload=payload)



class WebRTC(object):

    _current_id_url = None
    _socket_id = None

    def __init__(self):
        self.rooms = dict()
        self.users = dict()
        self.users_by_stream = dict()
        self.users_by_username = dict()

    def get_room(self, room):
        print 'Getting room ', room
        if room not in self.rooms:
            print 'Room not found, creating.'
            self.rooms[room] = WebRTCRoom(room)
        return self.rooms[room]

    def get_current_user(self):
        if request.stream_id and self.users_by_stream[request.stream_id]:
            return self.users_by_stream[request.stream_id]

        return None

    def disconnected(self, stream_id):
        user = rtc.users[stream_id]
        for room in user.rooms:
            room.user_leave(user)
        del rtc.users[stream_id]
        del rtc.users_by_stream[stream_id]

rtc = WebRTC()

def event_stream(stream_id):
    """SSE stream handler for clients"""
    connected = True
    user = rtc.users_by_stream[stream_id]
    try:
        yield 'data: %s\n\n' % json.dumps(dict(event='hello', stream_id=stream_id))
    except:
        print 'Error sending hello to %s' % stream_id
        connected = False
        print 'Stream %s is disconnected' % stream_id
        rtc.disconnected(stream_id)
        return

    while connected:
        message = user.messages.get(block=True, timeout=None)
        if message != '{"event": "heartbeat"}':
            print 'Sending %s to %s' % (message, stream_id)
        try:
            yield 'data: %s\n\n' % message
        except:
            print 'socket Error sending message to %s' % stream_id
            connected = False
            print 'Stream %s is disconnected' % stream_id
            rtc.disconnected(stream_id)
            return


def heartbeat(delay):
    """Heartbeat thread to monitor SSE streams"""
    while True:
        for user in rtc.users:
            rtc.users[user].emit('heartbeat')
        time.sleep(delay)
thread.start_new_thread(heartbeat, (heartbeat_interval,))


@app.before_request
def before_request():
    stream_id = None
    user = None
    if 'X-Stream-ID' in request.headers:
        stream_id = request.headers['X-Stream-ID']
        if stream_id in rtc.users:
            user = rtc.users[stream_id]
    setattr(request, 'stream_id', stream_id)
    setattr(request, 'webrtc_user', user)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/stream')
def stream():
    """SSE stream handler"""
    stream_id = uuid.uuid4().get_hex()
    rtc.users[stream_id] = WebRTCUser(stream_id)
    rtc.users_by_stream[stream_id] = rtc.users[stream_id]
    return Response(stream_with_context(event_stream(stream_id)),
        mimetype="text/event-stream")

@app.route('/debug')
def debug():
    return render_template('debug.html', rtc=rtc)

@app.route('/set_username', methods=['POST'])
def on_set_name():
    print 'Set username', request.form

    if len(request.form['username']) == 0:
        # TODO: more name validation
        return jsonify(dict(
            error='Invalid username',
            username=request.form['username']
        ))

    # Verify username is not alread in use
    for id in rtc.users:
        user = rtc.users[id]
        if user.username == request.form['username'] and \
           user.id != request.stream_id:
            return jsonify(error='Username already in use', _status=400)

    user = rtc.get_current_user()

    if not user:
        return jsonify(error="Missing or invalid X-Stream-ID header",
            _status=400)

    old_username = user.username
    if old_username:
        rtc.users_by_username[old_username] = None
    rtc.users_by_username[request.form['username']] = user
    user.username = request.form['username']
    for room in user.rooms:
        room.emit('username_change',
            old_username=old_username,
            username=user.username,
            exclude=user.id)

    return jsonify(success=True)

@app.route('/join_room', methods=['POST'])
def on_join_room():
    """Join a webRTC room"""
    print 'join_room', request.form
    # TODO: room name validation
    room = rtc.get_room(request.form['room'])
    user = rtc.get_current_user()
    room.user_join(user)
    data = dict(
        room=room.name,
        users=[],
        encryption=None
    )
    print room, room.users
    for patron in room.users:

        if patron.id != user.id:
            data['users'].append(dict(
                username=patron.username,
            ))

    return jsonify(data)

@app.route('/leave_room', methods=['POST'])
def on_leave_room():
    print 'leave_room', request.form
    username = request.form['username']
    room = request.form['room']
    leave_room(room)

@app.route('/room_info', methods=['POST'])
def on_room_info():
    print 'room_info', request.form
    user = rtc.get_current_user()
    room = request.form['room']
    encryption, browser, browser_version = '', '', ''
    if room in encryption:
        encryption = rtc.encryption[room]
        browser = rtc.browser[room]
        browser_version = rtc.browser_version[room]
    user.emit('receive_room_info',
        encryption=encryption,
        browser=browser,
        browser_version=browser_version
    )
    return jsonify(success=True)

@app.route('/send_ice_candidate', methods=['POST'])
def on_send_ice_candidate():
    print 'send_ice_candidate', request.form
    sender = rtc.get_current_user()
    user = rtc.users_by_username[request.form['username']]
    user.emit('receive_ice_candidate',
        candidate=request.form['candidate'],
        username=sender.username
    )
    return jsonify(success=True)

@app.route('/send_offer', methods=['POST'])
def on_send_offer():
    print 'send_offer', request.form
    sender = rtc.get_current_user()
    user = rtc.users_by_username[request.form['username']]
    user.emit('receive_offer',
        sdp=request.form['sdp'],
        username=sender.username
    )
    return jsonify(success=True)

@app.route('/send_answer', methods=['POST'])
def on_send_answer():
    print 'send_answer', request.form
    sender = rtc.get_current_user()
    user = rtc.users_by_username[request.form['username']]
    user.emit('receive_answer',
        sdp=request.form['sdp'],
        username=sender.username
    )
    return jsonify(success=True)

@app.route('/get_rooms', methods=['GET', 'POST'])
def get_rooms():
    getRooms = []
    for room in rtc.rooms:
        getRooms.insert(0, room)
    return jsonify(getRooms)

@app.route('/get_users_in_room/<room>', methods=['GET'])
def get_users_in_room(room):
    get_users_in_room = []
    room = rtc.get_room(room)
    for user in room.users:
        get_users_in_room.insert(0, user.username)
    return jsonify(get_users_in_room)

@app.route('/leave_other_rooms/<newroom>/<username>', methods=['GET'])
def leave_rooms(newroom, username):
    user = rtc.users_by_username[username];
    # user.emit_to_rooms('user_leave');
    for room in rtc.rooms:
        if(room != newroom):
            room = rtc.get_room(room)
            room.user_leave(user)
    return jsonify(success=True)

if __name__ == '__main__':
    app.run('0.0.0.0')
