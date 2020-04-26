const express = require('express');
const WebSocket = require('ws');
const kafka = require('kafka-node');
const multer = require('multer');
const multerS3 = require('multer-s3');
const cors = require('cors');
const path = require('path');
const url = require('url');
const uuid = require('uuid')

require('dotenv').config();

const app = express();
const socketServer = new WebSocket.Server({ port: process.env.WEB_SOCKET_PORT });

app.use(cors())


/**************************/
/* Kafka functions        */
/**************************/

function publish(topic, message) {
  const client = new kafka.KafkaClient({ kafkaHost: process.env.KAFKA_ENDPOINT }),
    producer = new kafka.Producer(client);

  // First wait for the producer to be initialized
  producer.on(
    'ready',
    () => {
      // Update metadata for the topic we'd like to publish to
      client.refreshMetadata(
        [topic],
        (err) => {
          if (err) {
            throw err;
          }

          console.log(`Sending message to ${topic}: ${message}`);
          producer.send(
            [{ topic, messages: [message] }],
            (err, result) => {
              console.log(err || result);
            }
          );
        }
      );
    }
  );

  // Handle errors
  producer.on(
    'error',
    (err) => {
      console.log('error', err);
    }
  );
}


function send_kafka_message(uid, image_name) {
  let message = '{"uid":"' + uid + '","image_name":"' + image_name + '"}';
  publish(process.env.KAFKA_TOPIC, message)
}



/**************************/
/* S3 functions           */
/**************************/

// Create the S3 client
const AWS = require('aws-sdk');
// AWS.config.logger = console; // Debug purposes
AWS.config.update({
  region: '',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  sslEnabled: (process.env.S3_ENDPOINT.includes('https') ? true : false),
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
});
const s3Endpoint = process.env.S3_ENDPOINT;
var s3 = new AWS.S3({ endpoint: s3Endpoint });

/**************************/
/* Upload functions       */
/**************************/
var cloudStorage = multerS3({
  s3: s3,
  bucket: process.env.BUCKETNAME,
  contentType: multerS3.AUTO_CONTENT_TYPE,
  metadata: function (request, file, ab_callback) {
    ab_callback(null, { fieldname: file.fieldname });
  },
  key: function (request, file, ab_callback) {
    var newFileName = request.params.uid + "-" + file.originalname;
    ab_callback(null, newFileName);
  },
});

var upload = multer({ storage: cloudStorage }).array('file');


/**************************/
/* API                    */
/**************************/

// API - test
app.get('/hello', function (req, res) {
  return res.send('Hello Server')
})

// API - List bucket content
app.get('/listimages', function (req, res, next) {
  s3.listObjectsV2({ Bucket: process.env.BUCKETNAME }, function (err, data) {
    if (err) {
      console.log(err, err.stack); // an error occurred
      res.send(err)
    }
    else {
      console.log(data);           // successful response
      let images = data.Contents.map(a => a.Key);
      res.send(images);
    }
  });
})

// API - get image
app.get('/image/:id', function (req, res, next) {
  var s3Stream = s3.getObject({ Bucket: process.env.BUCKETNAME, Key: req.params.id }).createReadStream();
  // Listen for errors returned by the service
  s3Stream.on('error', function (err) {
    // NoSuchKey: The specified key does not exist
    console.error(err);
  });

  s3Stream.pipe(res).on('error', function (err) {
    // capture any errors that occur when writing data to the file
    console.error('File Stream:', err);
  }).on('close', function () {
    console.log('Done.');
  });
})

// API - upload images
app.post('/upload/:uid', function (req, res) {
  upload(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      console.log(err)
      return res.status(500).json(err)
      // A Multer error occurred when uploading.
    } else if (err) {
      console.log(err)
      return res.status(500).json(err)
      // An unknown error occurred when uploading.
    }
    for (let i = 0; i < req.files.length; i++) {
      console.log('Sendig Kafka message')
      send_kafka_message(req.params.uid, req.files[i].key)
    }
    return res.status(200).send(req.file)
    // Everything went fine.
  })
});

// API - receive result
app.get('/result', function (req, res, next) {
  console.log('new result received')
  socketServer.clients.forEach(function each(ws) {
    if (ws.uid === req.query.uid) {
      ws.send(JSON.stringify({ topic: 'result', data: { image_name: req.query.image_name, prediction: req.query.prediction, confidence: req.query.confidence } }))
    }
  });
  return res.send('Result received')
})

// API - receive message
app.get('/message', function (req, res, next) {
  console.log('new message received')
  socketServer.clients.forEach(function each(ws) {
    if (ws.uid === req.query.uid) {
      ws.send(JSON.stringify({ topic: 'message', data: { message: req.query.message } }))
    }
  });
  return res.send('Message received')
})

/*  Server */

app.use(express.static(path.join(__dirname, '/build')));

app.listen(process.env.LISTEN_PORT, function () {
  console.log(`App running on port ${process.env.LISTEN_PORT}`);
});

socketServer.on('connection', (socketClient, req) => {
  const parameters = url.parse(req.url, true);

  socketClient.uid = parameters.query.uid
  console.log('connected: ' + socketClient.uid);

  socketClient.on('message', (message) => {
    socketClient.send('Bonnar')
  });

  socketClient.on('close', (socketClient) => {
    console.log('closed');
  });
});