/**
* kurento-rtp-client (c) 2016-2017 Mario Gasparoni Junior
*
* Freely distributed under the MIT license
*/


var path = require('path');
var url = require('url');
var minimist = require('minimist');
var os = require('os');
var child_process = require('child_process');
var fs = require('fs');
const WebSocket = require('ws');

process.env.NODE_TLS_REJECT_UNAUTHORIZED=0;
process.on('SIGTERM', exit,1);
process.on('SIGINT', exit,1);

const MIN_AUDIO_PORT=5000;
const MAX_AUDIO_PORT=20000;
const MIN_VIDEO_PORT=30000;
const MAX_VIDEO_PORT=45000;

// CODEC configuration
const AUDIO_CODEC_ID=9;
const AUDIO_CODEC_NAME='G722'
const AUDIO_SAMPLE_RATE=16000;
const AUDIO_CHANNELS=1;
const VIDEO_CODEC_ID=96;
const VIDEO_CODEC_NAME='H264';
const VIDEO_SAMPLE_RATE=90000;

//FFMPEG configuration
var FFMPEG_PATH;
var MPLAYER_PATH;
var FFPLAY_PATH;
const VIDEO_ENCODER_NAME = 'copy';
//read video from command line
var localIpAddress = null;
var localAudioPort = null;
var localVideoPort = null;
var localSdp = null;

errorHandler();

var argv = minimist(process.argv.slice(2), {
  default: {
      ws_uri: 'wss://localhost:8443/kurentomcu',
      room_id: 'room1',
      input_video : '',
      receive_only: false
  }
});

if (!argv.input_video && !argv.receive_only) {
  console.log('[media] ERROR - You must specify an input video'
    + ' (use --input_video option\)');
  exit(1);
}

const ws = new WebSocket(argv.ws_uri);

ws.on('open', function () {
  console.log('[ws]  Connected to: ' + argv.ws_uri);
  start();
});

ws.onmessage = function(message) {
  var parsedMessage = JSON.parse(message.data);
  console.info('Received message: ' + message.data);

  switch (parsedMessage.id) {
    case 'startResponse':
      startResponse(parsedMessage);
      break;
    case 'error':
      onError('Error message from server: ' + parsedMessage.message);
      break;
    default:
      onError('Unrecognized message', parsedMessage);
  }
}

function start() {
  if (argv.receive_only) {
    getFFplayPath(function (error, path) {
      if (error) {
        console.log('[media] ERROR - Couldn\'t find ffplay in the system')
        exit(1);
      }
      FFPLAY_PATH = path;
      startSignaling();
    });
  } else {
    getFFmpegPath(function (error, path) {
      if (error) {
        console.log('[media] - ERROR - Couldn\'t find FFmpeg in the system')
        exit(1);
      }
      FFMPEG_PATH = path;
      startSignaling();
    });
  }
}

function startSignaling() {
  console.log('[signaling] Start signaling');

  localIpAddress = getLocalIpAddress();
  localAudioPort = getAudioPort();
  localVideoPort = getVideoPort();

  localSdp = generateSdp(localIpAddress, localAudioPort, localVideoPort,
    argv.receive_only);

  var message = {
    id : 'start',
    roomId : argv.room_id,
    sdpOffer : localSdp
  }

  console.log('[media]  Local SDP: \n' + localSdp + '\n');
	sendMessage(message);
}

function generateSdp(localIpAddress, localAudioPort, localVideoPort,
  receiveOnly) {
  var sps = getSequenceParameterSet();
  var profileLevelId =  getProfileLevelId();

  var sdp = 'v=0\n'
  + 'o=- 0 0 IN IP4 ' + localIpAddress + '\n'
  + 's=kurentoclient\n'
  + 'c=IN IP4 ' + localIpAddress + '\n'
  + 't=0 0\n'
  + 'a=' + (receiveOnly ? 'recvonly' : 'sendrecv') + '\n'
  + 'm=audio ' + localAudioPort + ' RTP/AVP ' + AUDIO_CODEC_ID + '\n'
  + 'a=rtpmap:' + AUDIO_CODEC_ID + ' ' + AUDIO_CODEC_NAME + '/'
    + AUDIO_SAMPLE_RATE + '/' + AUDIO_CHANNELS  + '\n'
  + 'm=video ' + localVideoPort + ' RTP/AVP ' + VIDEO_CODEC_ID + '\n'
  + 'a=rtpmap:' + VIDEO_CODEC_ID + ' ' + VIDEO_CODEC_NAME + '/'
    + VIDEO_SAMPLE_RATE + '\n';
  + 'a=fmtp:' + VIDEO_CODEC_ID + ' ' + 'sprop-parameter-sets=' + sps + ';'
    + 'profile-level-id=' + profileLevelId + '\n';

  return sdp;
}


function getAudioPort() {
  return getRandomPort(MIN_AUDIO_PORT, MAX_AUDIO_PORT);
}

function getVideoPort() {
  return getRandomPort(MIN_VIDEO_PORT, MAX_VIDEO_PORT);
  //return '30000';
}

function getLocalIpAddress() {
  var interfaces = os.networkInterfaces();
  for (var interface in interfaces) {
    for (var address in interfaces[interface]) {
      if (interfaces[interface][address].family === 'IPv4'
        && interfaces[interface][address].internal === false) {
        return interfaces[interface][address].address;
      }
    }
  }
  return '127.0.0.1';
}

function getRandomPort(min,max) {
  return Math.floor(Math.random()*(max-min +1)) + min;
}

function getSequenceParameterSet() {
  //return 'Z2QAH6zZgLQ1+eagQEAoAAAfSAAF3AR4wYzQ,aOl4bLIs'; //720p
  return 'Z0LAHtkAoD2hAAADAAEAAAMAKA8WLkg=,aMuMsg==';
}

function getProfileLevelId() {
  return '64001E';
  //return '64001F';
}

function onError(error) {
	console.error(error);
}

function startResponse(message) {
  console.log('[ws]  SDP answer received from server. Processing ...');
  processAnswer(message.sdpAnswer);
}

function processAnswer(remoteSdp) {
  console.log('[media]  Remote SDP:\n' + remoteSdp + '\n');

  if (remoteSdp) {
    startAudioStream(remoteSdp, argv.receive_only, localSdp);
    startVideoStream(remoteSdp, argv.receive_only, localSdp);
  }
}

function startAudioStream(remoteSdp, receiveOnly, localSdp) {
  console.log('[media] Starting audio stream');

  if (!receiveOnly) {
    generateConcatInputFile(argv.input_video, function (error,inputPath) {
      if (error) {
        console.log('[media] ERROR - Couldn\'t write temporary input file - '
          + error.code)
        exit(1);
      }
      var destinationIpAddress;
      var cInfo;
      var connectionInfo = remoteSdp.match(/\nc=IN IP4 \d+.\d+.\d+.\d+/g);
      if (connectionInfo) {
        cInfo = connectionInfo[0].split(' ');
        if (cInfo) {
          destinationIpAddress = cInfo[2];
        }
      }

      var destinationPort;
      var mInfo;
      var mediaInfo = remoteSdp.match(/\nm=audio \d+ RTP\/AVP/g);
      if (mediaInfo) {
        mInfo = mediaInfo[0].split(' ');
        if (mInfo) {
          destinationPort = mInfo[1];
        }
      }

      var ffmpegArgs = [
        '-f','concat',
        '-re',
        '-i',inputPath,
        '-vn',
        '-ac','1',
        '-acodec',AUDIO_CODEC_NAME.toLowerCase(),
        '-ar', AUDIO_SAMPLE_RATE,
        '-f', 'rtp',
        '-payload_type', AUDIO_CODEC_ID,
        'rtp://' + destinationIpAddress + ':' + destinationPort + '?localport='
          + localAudioPort,
        '-loglevel','quiet'
      ];

      startStream(FFMPEG_PATH, ffmpegArgs);
    });
  }
}

function startVideoStream(remoteSdp, receiveOnly, localSdp) {
  console.log('[media] Starting video stream');

  if (receiveOnly) {
    if (!localSdp) {
      console.log('[media] ERROR - Couldn\'t find local SDP');
      exit(1);
    }

    generateTempSdpFile(localSdp, function (error, path) {
      if (error) {
        console.log('[media] ERROR - Couldn\'t write temporary sdp file - '
          + error.code)
        exit(1);
      }
      var ffplayArgs = [
        '-i',path,
        '-loglevel','quiet'
      ];

      startStream(FFPLAY_PATH, ffplayArgs);
    });
  } else {
    generateConcatInputFile(argv.input_video, function (error,inputPath) {
      if (error) {
        console.log('[media] ERROR - Couldn\'t write temporary input file - '
          + error.code)
        exit(1);
      }
      var destinationIpAddress;
      var cInfo;
      var connectionInfo = remoteSdp.match(/\nc=IN IP4 \d+.\d+.\d+.\d+/g);
      if (connectionInfo) {
        cInfo = connectionInfo[0].split(' ');
        if (cInfo) {
          destinationIpAddress = cInfo[2];
        }
      }

      var destinationPort;
      var mInfo;
      var mediaInfo = remoteSdp.match(/\nm=video \d+ RTP\/AVP/g);
      if (mediaInfo) {
        mInfo = mediaInfo[0].split(' ');
        if (mInfo) {
          destinationPort = mInfo[1];
        }
      }

      var ffmpegArgs = [
        '-re',
        '-f','concat',
        '-i',inputPath,
        '-vcodec',VIDEO_ENCODER_NAME,
        '-an',
        '-f', 'rtp',
        '-payload_type', VIDEO_CODEC_ID,
        'rtp://' + destinationIpAddress + ':' + destinationPort + '?localport='
          + localVideoPort,
        '-loglevel','quiet'
      ];

      startStream(FFMPEG_PATH, ffmpegArgs);
    });
  }
}

function startStream(app_path, appArgs) {
  console.log('[media ] Running stream with the command-line:\n'
    + app_path + ' ' + appArgs.join(' '));

  child_process.spawn(app_path, appArgs);
}

function stop() {
  if (!ws) {
    return;
  }

  switch (ws.readyState) {
    case ws.CLOSED:
      console.log('[app] Video call already stopped ...');
      return;
    break;
    case ws.CONNECTING:
    break;
    default:
      console.log('[app] Stopping video call ... ');
      var message = {
        id : 'stop'
      }
      sendMessage(message);

    break;
  }
}

function exit(code) {
  stop();
  console.log('[app] Bye!');
  process.exit(code)
}

function getFFmpegPath(callback) {
  getApplicationPath('ffmpeg', function (error, path) {
    return callback(error,path);
  });
}

function getFFplayPath(callback) {
  getApplicationPath('ffplay', function (error, path) {
    return callback(error,path);
  });
}

function getMplayerPath(callback) {
  getApplicationPath('mplayer', function (error, path) {
    return callback(error,path);
  });
}

function getApplicationPath(app, callback) {
  child_process.exec('which ' + app, function (error, stdout, stderr){
    if (error) {
      return callback(error);
    }
    return callback(null,stdout.trim());
  });
}

function generateTempSdpFile(sdp, callback) {
  var tempPath = '/tmp';
  var fileName = 'kurentoclient'
  var fileSuffix = new Date().getTime() + '.tmp';
  var fullPath = tempPath + '/' + fileName + '_' + fileSuffix;
  fs.open(fullPath, 'w', function (error, fileDescriptor) {
    if (error) {
      return callback(error);
    }

    fs.write(fileDescriptor, sdp, function (error) {
      if (error) {
        return callback(error);
      }
      return callback(null, fullPath);
    });
  });
}

function generateConcatInputFile(inputPath, callback) {
  var tempPath = '/tmp';
  var fileName = 'kurentoclient_concat'
  var fileSuffix = new Date().getTime() + '.tmp';
  var fullPath = tempPath + '/' + fileName + '_' + fileSuffix;
  fs.open(fullPath, 'w', function (error, fileDescriptor) {
    if (error) {
      return callback(error);
    }

    var data = '';
    for (var i=0; i<6*60*24;i++) {
      data+='file '+ inputPath + '\n';
    }

    fs.write(fileDescriptor, data, function (error) {
      if (error) {
        return callback(error);
      }
      return callback(null, fullPath);
    });
  });
}

function sendMessage(message) {
  try {
    if (ws) {
      var jsonMessage = JSON.stringify(message);
      //console.log('[ws] Sending message: ' + jsonMessage);
      ws.send(jsonMessage);
    }
  } catch (error) {
    console.log('[ws] ERROR - ' + error);
  }
}

function errorHandler() {
  process.on('uncaughtException', function (error) {
    console.log('[app] ERROR - ' + error);
    switch (error.code) {
      case 'ECONNREFUSED':
      break;
      case 'ECONNRESET':
      break;

      default:
      break;
    }
    exit(1);
  });
}

