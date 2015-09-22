;(function() {

    ;(function(strings, regex) {
        /*
         * Uses single percentage sign for formatting and double percentage sign for escaping.
         * > "you don't have to plus %0 together, you can format %0 %1%% of the time now!".format('strings', 100)
         * "you don't have to plus strings together, you can format strings 100% of the time now!"
         */
        strings.f = function () {
            var args = arguments;
            return this.replace(regex, function(token) {
                var index = parseInt(token.substring(1, token.length ));
                if (index >= 0 && args[index]) {
                    return args[index];
                } else if (token === '%%') {
                    return '%';
                }
                return "";
            });
        };
        strings.bold = function() {
            return "<strong>%0</strong>".f(this);
        }
        /*
         * Converts a string into a unique number based off the sum of the
         * character code values of each character.
         */
        strings.toID = function() {
            var id = 0;
            for (var x = 0; x < this.length; x++)
                id += this.charCodeAt(x);
            return id;
        }
        /*
         * Use this to avoid xss
         * recommended escaped char's found here
         * https://www.owasp.org/index.php/XSS_(Cross_Site_Scripting)_Prevention_Cheat_Sheet#RULE_.231_-_HTML_Escape_Before_Inserting_Untrusted_Data_into_HTML_Element_Content
         */
        strings.sanitize = function() {
            return this.replace(/[\<\>''\/]/g, function(c) {
                var sanitize_replace = {
                    '<' : '&lt;',
                    '>' : '&gt;',
                    "'" : '&quot;',
                    "'" : '&#x27;',
                    '/' : '&#x2F;'
                }
                return sanitize_replace[c];
            });
        }
    })(String.prototype, /%(\d+)|%%/g);

    var browser = 'unsupported';

    /*
     * Determine the correct RTC functions and classes
     */
    if (window.mozRTCPeerConnection) {
        browser = 'firefox';
        var PeerConnection = mozRTCPeerConnection;
        var iceCandidate = mozRTCIceCandidate;
        var SessionDescription = mozRTCSessionDescription;
    } else if (window.PeerConnection ||
               window.webkitPeerConnection00 ||
               window.webkitRTCPeerConnection) {
        browser = 'chrome';
        var PeerConnection = window.PeerConnection ||
                             window.webkitPeerConnection00 ||
                             window.webkitRTCPeerConnection;
        var iceCandidate = RTCIceCandidate;
        var SessionDescription = RTCSessionDescription;
        navigator.getUserMedia({
            video: true,
            audio: true
          });
    }

    var rtc_unsupported = 0;
    var reliable_false  = 1;
    var reliable_true   = 2;

    var sent_no_otr   = 0;
    var sent_some_otr = 1;
    var sent_all_otr  = 2;
    var received      = 0;
    var received_otr  = 2;

    var rtc = {
        STUN_SERVERS: { // STUN/ICE server(s) to use for PeerConnections
            iceServers: [{ url: 'stun:stun.l.google.com:19302' } ]
        },
        peerConnections: {}, // Reference to PeerConnection instance
        dataChannels: {},
        connected: {},
        streams: [],
        socket: null, // Web socket
        connected: false,
        me: null, // ID f this connection
        room: null,
        _events: {}, // Event callbacks
        using_otr: false
    };

    /*
     * Set callback(s) for space-deliminated event string.
     */
    rtc.on = function(event, callback) {
        var events = event.split(' ');
        for (var x = 0; x < events.length; x++) {
            if (events[x].length == 0)
                continue;
            rtc._events[events[x]] = rtc._events[events[x]] || [];
            rtc._events[events[x]].push(callback);
        }
        return this;
    }

    /*
     * Fire callback(s) for space-deliminated event string.
     */
    rtc.fire = function(event/* ... args */) {
        var events = event.split(' ');
        var args = Array.prototype.slice.call(arguments, 1);

        for (var x = 0; x < events.length; x++) {
            var callbacks = rtc._events[events[x]] || [];
            for(var y = 0; y < callbacks.length; y++)
                callbacks[y].apply(null, args)
        }
        return this;
    }

    /*
     * Connects to the SSE source.
     */
    rtc.connect = function(stream_url) {
        // Connect to server
        rtc.stream = new EventSource(stream_url);
        rtc.stream_url = stream_url;
        rtc.fire('connecting');

        rtc.stream.onmessage = function(event) {
            var data = JSON.parse(event.data);
            rtc.fire('event_source_message', event);
            rtc.fire(data.event, data);
        }

        rtc.stream.onopen = function(event) {
            if (rtc.stream.readyState == 1) {
                rtc.connected = true;
                rtc.fire('connect', stream_url, event);
            }
        }

        rtc.stream.onerror = function(event) {
            if (rtc.stream.readyState != 1 && rtc.connected) {
                rtc.connected = false;
                rtc.fire('disconnect', stream_url);
            }
            rtc.fire('event_source_error', stream_url, event);
        }
    }

    /*
     * Emit a request (event) to the server.
     */
    rtc.emit = function(event, data) {
        var type = typeof data === 'string' ? data : 'post';
        return $.ajax({
            url: '%0/%1'.f(document.location.origin, event),
            data: data,
            dataType: 'json',
            type: type,
            headers: { "X-Stream-ID": rtc.stream_id }
        });
    }

    /*
     * Creates a new peerConnection object for a given username.
     */
    rtc.create_peer_connection = function(username) {
        var config;
        if (rtc.dataChannelSupport != rtc_unsupported) {
            config = rtc.dataChannelConfig;
        }
        /* create a new peer connection! */
        var pc = rtc.peerConnections[username] = new PeerConnection(rtc.STUN_SERVERS, config);

        rtc.fire('new_peer_connection', username, config);

        pc.onicecandidate = function(event) {
            if (event.candidate == null)
                return

            //TODO - does chrome want this only after onicecandidate ?? rtc.createDataChannel(username);
            //if (!rtc.dataChannels[username]) {
            //  rtc.createDataChannel(username);
            //}
            rtc.emit('send_ice_candidate', {
                label: event.candidate.label,
                candidate: JSON.stringify(event.candidate),
                username: username
            });

            rtc.fire('ice_candidate', username, event.candidate, event);

            /* bloody hell chrome, we have to remove this handler as you send a ton of ice canidates & we only need one */
            pc.onicecandidate = null;
        };

        pc.onopen = function() {
            // TODO: Finalize this API
            rtc.fire('peer_connection_opened', username);
        };

        pc.onaddstream = function(event) {
            // TODO: Finalize this API
            rtc.fire('add_remote_stream', username,  event.stream);
        };

        pc.oniceconnectionstatechange = function(event) {
            if (event.target.iceConnectionState == 'connected') {
                can_close = true; /* TODO! - make per channel */
            }
            rtc.fire('ice_state_change', event);
        }

        //if (rtc.dataChannelSupport != rtc_unsupported) {
        /* this might need to be removed/handled differently if this is ever supported */
        pc.ondatachannel = function (event) {
            rtc.add_data_channel(username, event.channel);
            rtc.fire('add_data_channel', username, event);
        }
        pc.onidpassertionerror = pc.onidpvalidationerror = function(e) {
            rtc.fire('pc_error', username, e)
        }
        return pc;
    }


    /*
     * Send intial WebRTC peerConnection offer.
     */
    rtc.send_offer = function(username) {
        var pc = rtc.peerConnections[username];
        pc.createOffer( function(session_description) {
            //description callback? not currently supported - http://www.w3.org/TR/webrtc/#dom-peerconnection-setlocaldescription
            pc.setLocalDescription(session_description, function() {
                rtc.fire('set_local_description', username);
            }, function(error) {
                rtc.fire('set_local_description_error', username, error);
            });

            rtc.emit('send_offer', {
                username: username,
                    sdp: JSON.stringify(session_description)
            });
            rtc.fire('send_offer', username);
        }, function(error) {
            rtc.fire('send_offer_error', username, error);
        });
    }

    /*
     * Receive intial WebRTC peerConnection offer.
     */
    rtc.receive_offer = function(username, sdp) {
        var pc = rtc.peerConnections[username];
        var sdp_reply = new SessionDescription(JSON.parse(sdp));
        pc.setRemoteDescription(sdp_reply, function () {
            /* setRemoteDescription success */
            rtc.send_answer(username);
            rtc.fire('set_remote_description', username);
        },function(error){
            rtc.fire('set_remote_description_error', username, error);
        });
    }

    /*
     * Send WebRTC peerConnection answer back to user who sent offer.
     */
    rtc.send_answer = function(username) {
        var pc = rtc.peerConnections[username];

        pc.createAnswer(function(session_description) {
            rtc.fire('send_offer', username)
            pc.setLocalDescription(session_description, function() {
                rtc.emit('send_answer',{
                    username: username,
                    sdp: JSON.stringify(session_description)
                });
                rtc.fire('set_local_description', username)
            },function(err) {
                rtc.fire('set_local_description_error', username, err);
            });
        }, function(e) {
            rtc.fire('send_offer_error'. username, err);
        });
    }

    /*
     * The user who sent original WebRTC offer receives final answer.
     */
    rtc.receive_answer = function(username, sdp_in) {
        var pc = rtc.peerConnections[username];
        var sdp = new SessionDescription(JSON.parse(sdp_in));
        pc.setRemoteDescription(sdp, function() {
            rtc.fire('set_remote_description', username);
        },function(err) {
            rtc.fire('set_remote_description_error', username)
        });
    }

    /*
     * Creates a dataChannel instance for a peer.
     */
    rtc.create_data_channel = function(username, label) {
        var pc = rtc.peerConnections[username];
        var label = label || String(username); // need a label
        if (rtc.dataChannelSupport == reliable_false) {
            return;
        }
        /* else reliability true! */

        try {
            channel = pc.createDataChannel(label, { reliable: true });
        } catch (error) {
            rtc.fire('data_channel_error', username, error)
            throw error;
        }
        return rtc.add_data_channel(username, channel);
    };

    /*
     * Adds callbacks to a dataChannel and stores the dataChannel.
     */
    rtc.add_data_channel = function(username, channel) {
        channel.onopen = function() {
            channel.binaryType = 'arraybuffer';
            rtc.connected[username] = true;
            rtc.fire('data_stream_open', username);
        };

        channel.onclose = function(event) {
            delete rtc.dataChannels[username];
            rtc.fire('data_stream_close', username, channel);
        };

        channel.onmessage = function(message) {
            rtc.fire('data_stream_data', username, message);
        };

        channel.onerror = function(error) {
            rtc.fire('data_stream_error', username, error);
        };

        rtc.dataChannels[username] = channel;
        rtc.fire('data_channel_added', username, channel)
        return channel;
    }
    rtc.set_secret = function(secret) {
        rtc.using_otr = !!secret;
        rtc.otr_secret = secret;
        if (rtc.using_otr) {
            rtc.init_otr();
        }
        rtc.emit(secret? 'otr_on' : 'otr_off')
            .done(function(){ rtc.fire('set_secret'); });
        ;
        return this;
    }

    rtc.add_streams = function() {
        for (var i = 0; i < rtc.streams.length; i++) {
            var stream = rtc.streams[i];
            for (var connection in rtc.peerConnections) {
                rtc.peerConnections[connection].addStream(stream);
            }
        }
    }

    rtc.attach_stream = function(stream, dom_id) {
        document.getElementById(dom_id).src = window.URL.createObjectURL(stream);
    }

    rtc.send = function(message) {
        var status = sent_all_otr;
        var otr_sent = 0;
        for (var x = 0; x < rtc.usernames.length; x++) {
            var username = rtc.usernames[x];
            if (rtc.crypto_verified[username]) {
                rtc.send_otr_message(username, message);
                otr_sent++;
            }
            else
                rtc.dataChannels[username].send(message);
        }
        rtc.fire('message', rtc.username, message.sanitize(), sent_all_otr);
    }

    rtc.join_room = function(room) {
        rtc.room = room;
        if (rtc.connected)
            rtc.emit('join_room', { room: room, encryption: null })
                .done(function(json) {
                    rtc.fire('joined_room', room)
                       .fire('get_peers', json);
                })
        ;
    }

    rtc.set_username = function(username) {
        rtc.username = username;
        if (rtc.connected)
            rtc.emit('set_username', { username: username })
                .done(function() {
                    rtc.fire('set_username_success', username);
                })
                .fail(function(error) {
                    rtc.fire('set_username_error', username, error)
                })
            ;
    }

    rtc.packet_inbound = function(username, message) {
        message = message.sanitize();
        rtc.fire('message', username, message, true);
    }

    /* WebRTC SSE Callbacks */
    rtc.on('connect', function() {
        rtc.connected = true;
        if (rtc.username)
            rtc.set_username(rtc.username);
    })

    .on('hello', function(data) {
        rtc.stream_id = data.stream_id
    })

    .on('disconnect', function() {
        rtc.connected = false;
    })

    .on('get_peers', function(data) {
        var usernames = [];
        /* we already sanitize everything later, but rather be safe than sorry */
        for (var i = 0, len = data.users.length; i < len; i++) {
            var user  = data.users[i];
            var username = user.username = user.username.sanitize();
            rtc.is_using_otr[username] = user.using_otr;
            usernames.push(username);
            rtc.create_peer_connection(username);
            rtc.create_data_channel(username);
            rtc.send_offer(username);
        }
        rtc.usernames = usernames;
        rtc.users = data.users;

        rtc.first_connect = true

        rtc.fire('got_peers', data);

        rtc.first_connect = false;
    })

    .on('set_username_success', function(data) {
        if (rtc.room)
            rtc.join_room(rtc.room);
    })

    .on('user_join', function(data) {
        rtc.usernames.push(data.username);
        rtc.create_peer_connection(data.username);
        //rtc.create_data_channel(data.username);
        //rtc.send_offer(data.username);
        var pc = rtc.create_peer_connection(data.username);
        for (var i = 0; i < rtc.streams.length; i++) {
            var stream = rtc.streams[i];
            pc.addStream(stream);
       }
    })

    .on('remove_peer_connected', function(data) {
        rtc.connected[data.username] = false;
        rtc.fire('disconnect stream', data.username, rtc.usernames[data.username]);
        delete rtc.dataChannels[data.username];
        delete rtc.usernames[data.username];
        delete rtc.peerConnections[data.username];
    })

    .on('receive_ice_candidate', function(data) {
        var candidate = new iceCandidate(JSON.parse(data.candidate));
        rtc.peerConnections[data.username].addIceCandidate(candidate);
    })

    .on('receive_offer', function(data) {
        rtc.receive_offer(data.username, data.sdp);
    })

    .on('receive_answer', function(data) {
        rtc.receive_answer(data.username, data.sdp);
    })

    .on('data_stream_data', function(username, data) {
        if (rtc.is_using_otr[username]) {
            rtc.receive_otr_message(username, data);
        } else {

        }
    })
    ;

    rtc.dataChannelConfig = {optional: [ {'DtlsSrtpKeyAgreement': true} ] };

    // Determine Data Channel support
    try {
        /* first try reliable */
        var pc = new PeerConnection(rtc.STUN_SERVERS, rtc.dataChannelConfig);
        channel = pc.createDataChannel('supportCheck', { reliable: true });
        channel.close();
        rtc.dataChannelSupport = reliable_true;
    } catch(e) {
        try {
            /* then unreliable */
            var pc = new PeerConnection(rtc.STUN_SERVERS, rtc.dataChannelConfig);
            channel = pc.createDataChannel('supportCheck', { reliable: false });
            channel.close();
            rtc.dataChannelSupport = reliable_false;
        } catch(e) {
            /* then fail :( */
            rtc.dataChannelSupport = rtc_unsupported;
        }
    }
    rtc.fire('data_channel_reliability');

    /**********
     * Crypto *
     **********/

     rtc.otr_key;
     rtc.crypto_streams = [];
     rtc.crypto_receive_symmetric_keys = [];
     rtc.crypto_send_symmetric_keys = [];
     rtc.crypto_verified = {};
     rtc.request_chunk_decrypt_rand = [];
     rtc.is_using_otr = {};
     rtc.hashed_message = [];

     rtc.init_otr = function() {
        var key_worker = new Worker('/static/js/dsa-webworker.js?' + new Date().getTime());
        key_worker.onmessage = function(e) {
            rtc.otr_key = e.data.val;
            rtc.fire('otr_init_done');
        }
        key_worker.postMessage({seed: '' + new Date().getTime()});
     }

     rtc.go_otr_with = function(username) {
        rtc.fire('going_otr_with', username);
        var options = {
            fragment_size: 1000,
            priv: rtc.otr_key
        }
        rtc.crypto_verified[username] = false;
        var otr_stream = rtc.crypto_streams[username] = new OTR(options);
        otr_stream.ALLOW_V2 = false; /* We need V3 b/c we want the symmetric key generated for file transfers */
        otr_stream.REQUIRE_ENCRYPTION = true;

        otr_stream.on('ui', function(message, encrypted) {
            if (encrypted) {
                if(rtc.crypto_verified[username])
                    rtc.packet_inbound(username, message);
            } else {
                // Attempted to send non-encrypted message, not allowing to send!
            }
        });

        otr_stream.on('io', function(message) {
            rtc.dataChannels[username].send(message);
        });

        otr_stream.on('error', function(error) {
            rtc.fire('otr_stream_error', username, error);
        })

        otr_stream.on('status', function(state) {
            if (state === OTR.CONST.STATUS_AKE_SUCCESS) {
                rtc.fire('otr_ake_success', username);
                /* once we have AKE Success, do file transaction if we have not yet */
                if (!rtc.crypto_send_symmetric_keys[username]) {
                    /* Step 2) Send blank file to share symmetric crypto key */
                    this.sendFile('test'); /* send a non-real filename registering a pre-shared private key */
                }
            }

            if (state === OTR.CONST.STATUS_END_OTR) {
                rtc.fire('otr_disconnect', username);
            }

        });

        otr_stream.on('file', function(type, key, file) {
            if (type === 'send') {
                rtc.crypto_send_symmetric_keys[username] = key;
                rtc.fire('otr_send_key', username);
            }else if (type === 'receive') {
                rtc.crypto_receive_symmetric_keys[username] = key;
                rtc.fire('otr_receive_key', username)
            } else {
                rtc.fire('otr_file_error', username, type);
            }

            /* these are equal, so lets compare them to verify */
            if (rtc.crypto_receive_symmetric_keys[username] &&
                rtc.crypto_send_symmetric_keys[username]){
                if (rtc.crypto_send_symmetric_keys[username] != rtc.crypto_receive_symmetric_keys[username]) {
                    rtc.fire('otr_stream_error', 'non-matching crypto keys');
                } else {
                    /* if they are equal, then we can also want to verify identity using SMP */

                    /* Step 3) Socialist Millionaire Protocol
                     * ONLY A SINGLE HOST CAN START THIS!
                     * We have no concept of host/initiator, so choose host with lowest ID to start
                     * Convert both usernames into an ID number.
                     */
                    var me = rtc.username.toID(); /* remove letters and -'s */
                    var other = username.toID();
                    if (parseInt(me,10) > parseInt(other,10)) {
                        this.smpSecret(rtc.otr_secret);
                        rtc.fire('otr_smp_start', username);
                    } else {
                        rtc.fire('otr_smp_wait', username);
                    }
                }
            }
        });

        otr_stream.on('smp', function (type, data, act) {
            switch (type) {
                case 'question':
                    this.smpSecret(rtc.otr_secret);
                    rtc.fire('otr_smp_question', username);
                break
                case 'trust':
                    if (!data){
                        rtc.fire('otr_smp_failed', type, username, 'negotiation error');
                    }
                    if (data){
                        rtc.fire('otr_with', username)
                        /* Step 4) do not send messages until reached here! */
                        rtc.crypto_verified[username] = true;
                    }
                break
                case 'abort':
                    /* TODO - handle this better? */
                    rtc.fire('otr_smp_failed', username, type, 'negotiation was aborted');
                break;
                default:
                    rtc.fire('otr_smp_failed', username, type, 'unknown error');
                break;
            }
        });

        otr_stream.sendQueryMsg();

     }

    rtc.send_otr_message = function(username, message) {
        if (rtc.crypto_verified[username]) {
            rtc.crypto_streams[username].sendMsg(message);
        }
    }

    rtc.receive_otr_message = function(username, message) {
        rtc.crypto_streams[username].receiveMsg(message.data);
    }

    /***************
     * Crypto-JS functions
     * note: we had to redefine CryptoJS's namespace to not conflict with OTR CryptoJS code. No other changes were made.
     *      TODO - bring Rabbit's functionality into OTR's CryptoJS namespace
     * decrpyt & encrypt: file chunks QUICKLY using CryptoJS's Rabbit stream cipher
     * key: We are going to combine the symmetric key that was created during our OTR initiation with a randomly generated value.
     * That second random bit is to avoid sending the the same encrypted text multiple times. As we're sending this random value over our OTR channel
     * when we request a chunk, we should be able to assume it's safe to use.
     ****************/

    function generate_second_half_RC4_random() {
        var wordArray = RabbitCryptoJS.lib.WordArray.random(128/8); /* want this to be fast, so let's just grab 128 bits */
        return RabbitCryptoJS.enc.Base64.stringify(wordArray);
    }

    /* decrypt an inbound file peice */
    function file_decrypt(username, message) {
        if (rtc.crypto_verified[username]) {
            hash = CryptoJS.SHA256(message).toString(CryptoJS.enc.Base64);

            message = RabbitCryptoJS.Rabbit.decrypt(JSON.parse(message),
                rtc.crypto_receive_symmetric_keys[username] + rtc.request_chunk_decrypt_rand[username])
                .toString(CryptoJS.enc.Utf8);
            process_binary(username, base64DecToArr(message).buffer, hash); /* send back a hash as well to send back to the original host with the next request */
        }
    }

    /* encrypt and send out a peice of a file */
    function file_encrypt_and_send(username, message, additional_key, chunk_num) {
        /* MUST have completed OTR first */
        if (rtc.crypto_verified[username]) {
            message = _arrayBufferToBase64(message);
            message = JSON.stringify(RabbitCryptoJS.Rabbit.encrypt(message, rtc.crypto_send_symmetric_keys[username] + additional_key));

            if (chunk_num == 0) {
                hashed_message[username] = [];
            }
            rtc.hashed_message[username][chunk_num] = CryptoJS.SHA256(message).toString(CryptoJS.enc.Base64);

            /* This is the one other place we can send directly! */
            if (rtc.connection_ok_to_send[username]) {
                rtc.dataChannels[username].send(message);
            } else {
                rtc.fire('error', '"somehow downloading encrypted file without datachannel online?');
            }
        }
    }

    /* check if the previous hash sent back matches up */
    function check_previous_hash(username, chunk_num, hash) {
        if (chunk_num != 0) {
            if (rtc.hashed_message[username][chunk_num - 1] == hash) {
                return true; /* ok */
            } else {
                return false; /*not ok */
            }
        }
        return true; /* skip for 1st chunk */
    }


    /***************
     * base 64 functionaility for crypto operations
     ****************/

    /* credit to http://stackoverflow.com/questions/9267899/arraybuffer-to-base64-encoded-string */
    function _arrayBufferToBase64( buffer ) {
        var binary = ''
        var bytes = new Uint8Array( buffer )
        var len = bytes.byteLength;
        for (var i = 0; i < len; i++) {
            binary += String.fromCharCode( bytes[ i ] )
        }
        return window.btoa( binary );
    }

    /* credit to https://developer.mozilla.org/en-US/docs/Web/JavaScript/Base64_encoding_and_decoding#Solution_.232_.E2.80.93_rewriting_atob%28%29_and_btoa%28%29_using_TypedArrays_and_UTF-8 */
    function base64DecToArr (sBase64, nBlocksSize) {
        var sB64Enc = sBase64.replace(/[^A-Za-z0-9\+\/]/g, ""), nInLen = sB64Enc.length;
        var nOutLen = nBlocksSize ? Math.ceil((nInLen * 3 + 1 >> 2) / nBlocksSize) * nBlocksSize : nInLen * 3 + 1 >> 2;
        var taBytes = new Uint8Array(nOutLen);

        for (var nMod3, nMod4, nUint24 = 0, nOutIdx = 0, nInIdx = 0; nInIdx < nInLen; nInIdx++) {
            nMod4 = nInIdx & 3;
            nUint24 |= b64ToUint6(sB64Enc.charCodeAt(nInIdx)) << 18 - 6 * nMod4;
            if (nMod4 === 3 || nInLen - nInIdx === 1) {
                for (nMod3 = 0; nMod3 < 3 && nOutIdx < nOutLen; nMod3++, nOutIdx++) {
                    taBytes[nOutIdx] = nUint24 >>> (16 >>> nMod3 & 24) & 255;
                }
                nUint24 = 0;
            }
        }
        return taBytes;
    }
    function b64ToUint6 (nChr) {
      return nChr > 64 && nChr < 91 ?
          nChr - 65
        : nChr > 96 && nChr < 123 ?
          nChr - 71
        : nChr > 47 && nChr < 58 ?
          nChr + 4
        : nChr === 43 ?
          62
        : nChr === 47 ?
          63
        :
          0;
    }

    rtc.on('data_stream_open', function(username) {
        rtc.go_otr_with(username);
    })


    /********************
     * DOM interactions *
     ********************/

    var username_span = document.getElementById('username');
    var user_icon = document.getElementById('user_icon');
    var room_name = document.getElementById('room_name');
    var room_icon = document.getElementById('room_icon');
    var connection_status_div = document.getElementById('connection_status');
    var connection_icon = document.getElementById('connection_icon');
    var messages_div = document.getElementById('messages');
    var buffer_input = document.getElementById('buffer_input');

    var base_connection_icon = 'fa fa-circle ';

    var levels = ['success', 'error', 'operation', 'info']
    var print = {
        out: function(message, type) {
            var message_div = document.createElement('div');
            message_div.setAttribute('class','message ' + type);
            message_div.innerHTML = message;
            messages_div.appendChild(message_div);
            messages.scrollTop = messages_div.scrollHeight;
        }
    }
    rtc.print = print;
    for (var x = 0; x < levels.length; x++)
        print[levels[x]] = (function(level) { return function(message) { print.out(message, level)}})(levels[x]);

    rtc.on('connecting', function() {
        connection_status_div.innerHTML = 'Connecting...';
        connection_icon.setAttribute('class', base_connection_icon + 'connecting');
        print.operation('Connecting to %0...'.f(rtc.stream_url));
    })

    .on ('connect', function() {
        connection_status_div.innerHTML = 'Connected';
        connection_icon.setAttribute('class', base_connection_icon + 'online');
        print.success('Connected.');
        print.info('Set your username with the %0 command. ex: %0 your_name'.f('/nick'.bold()));
        print.info('Set OTR encryption with %0 command. ex: %0 something_secret'.f('/secret'.bold()));
        print.info('Join a chatroom with the %0 command. ex: %0 the_meeting_spot'.f('/join'.bold()));
    })

    .on('disconnect', function() {
        connection_status_div.innerHTML = 'Disconnected';
        connection_icon.setAttribute('class', base_connection_icon + 'offline');
    })

    .on ('set_username_success', function() {
        print.success('Username successfully set to %0.'.f(rtc.username.bold()));
        username_span.innerHTML = rtc.username;
    })

    .on ('set_username_error', function(data) {
        print.error('Failed to set username: %0.'.f(data.error));
        buffer_input.value = '/nick ' + data.username;
    })

    .on('set_secret', function() {
        $(user_icon).fadeOut(function() {
            user_icon.setAttribute('class', 'fa ' +
                (rtc.using_otr ? 'fa-user-secret' : 'fa-user'));
            $(user_icon).fadeIn();
        });
    })

    .on('joined_room', function() {
        $(room_icon).fadeOut(function() {
            room_icon.setAttribute('class', 'fa fa-users');
            $(room_icon).fadeIn();
        });
        $(room_name).html(rtc.room);
    })

    .on ('got_peers', function(data) {
        if (rtc.first_connect)
            print.info('Entered ' + rtc.room);

        if (rtc.usernames.length == 0)
            return print.info('You are the only user in this room.');

        var users = '';
        for (var x = 0; x < rtc.usernames.length; x++) {
            users += rtc.usernames[x].bold() + ' ';
        }
        print.info('Users in room: ' + users);
    })

    .on ('user_join', function(data) {
        print.info('User %0 has joined.'.f(data.username.bold()));
    })

    .on ('message', function(username, message, otr_status) {
        var $message = $(
            '<div class="message">' +
                '<span class="fa fa-lock"></span>' +
                '<span class="chat-user">%0:</span>'.f(username.bold()) +
                '<span class="message-inner">%0</span>'.f(message) +
            '</div>'
        ).appendTo(messages_div);
    })

    // Send RTC offer
    .on('send_offer', function(username) {
        print.operation('Sending RTC offer to %0...'.f(username.bold()));
    })
    .on('send_offer_error', function(username) {
        print,error('Failed to send RTC offer to %0.'.f(username.bold()));
    })

    // Receive RTC offer
    .on ('receive_offer receive_answer', function(data) {
        print.success('Received RTC offer from %0.'.f(data.username.bold()));
    })


    // Set Local Description for RTC
    .on('set_local_description', function(username) {
        print.success('Set local description for %0.'.f(username.bold()));
    })
    .on('set_local_description_error', function(username, error) {
        print.error('Failed to set local description for %0!'.f(username.bold()));
    })

    // set Remote Description for RTC
    .on('set_remote_description', function(username) {
        print.success('Set remote description for %0.'.f(username.bold()));
    })
    .on('set_remote_description_error', function(username, error) {
        print,error('Failed to set remote description for %0!'.f(username.bold()));
    })

    .on('ice_candidate', function(username) {
        print.success('Received ICE Candidate for %0'.f(username.bold()));
    })

    /* PeerConnection Events */
    .on('peer_connection_opened', function(username) {
        print.success('Peer connection opened for %0'.f(username.bold()));
    })
    .on('add_remote_stream', function(username) {
        print.success('Remote stream added for %0'.f(username.bold()));
    })
    .on('pc_error', function(username, e) {
        print.error('PeerConnection error when coonecting with %0'.f(username.bold()));
    })

    /* Data Stream Events */
    .on('create_data_channel', function(username) {
        print.operation('DataChannel starting for %0...'.f(username.bold()));
    })
    .on('data_stream_open', function(username) {
        print.success('DataChannel opened for %0.'.f(username.bold()));
    })
    .on('data_stream_close', function(username, channel) {
        print.error('DataChannel closed for %0.'.f(username.bold()));
    })

    /* OTR */
    .on('otr_init_begin', function() {
        print.operation('Creating OTR key, this may freeze your browser and take a moment...');
    })
    .on('otr_init_done', function() {
        print.success('OTR key created successfully.');
    })
    .on('go_otr_with', function(username) {
        print.operation('Establishing secure connection to go OTR with %0...'.f(username.bold()));
    })
    .on('otr_with', function(username) {
        print.success('OTR with %0, you may now safely communicate.'.f(username.bold()));
    })
    .on('failed_to_go_otr_with', function(username) {
        print.error('Failed to go OTR with %0.'.f(username.bold()));
    })
    .on('otr_stream_error', function(username, error) {
        print.error('OTR Stream error for %0: %1'.f(username.bold()));
    })
    .on('otr_failed', function(username, error) {
        print.error('Failed to establish OTR channel with %0: %1.'.f(username.bold(), error));
    })
    .on('error_sending_not_otr', function() {
        print.error('Message not sent because you have not gone OTR yet.');
    })
    ;

    var command_lookup = {
        connect: function(server) {
            if (!/^(http:\/\/|https:\/\/)/.test(server))
                server = 'http://' + server;
            rtc.connect(server + '/stream');
        },
        nick: rtc.set_username,
        join: rtc.join_room,
        secret: rtc.set_secret
    }

    buffer_input.addEventListener('keydown', function(event) {

        // Only capture returns
        if (event.keyCode != 13)
            return;
        event.preventDefault();

        var input = buffer_input.value;
        $(buffer_input).val('')
        setTimeout(function() {
            $(buffer_input).val('')
        },1);
        if (input.length === 0)
            return;
        if (input[0] === '/') {
            var command = input.match(/\/(\w+) (.*)/);
            command_lookup[command[1]](command[2]);
        } else {
            rtc.send(input);
        }
        return false;
    });

    window.rtc = rtc;
    rtc.connect(document.location.origin + '/stream');
})()
