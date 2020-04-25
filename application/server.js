const express = require('express');
const WebSocket = require('ws');
const kafka = require('kafka-node');
const multer = require('multer');
const multerS3 = require('multer-s3');
const cors = require('cors');
const path = require('path');
const url = require('url');
const uuid = require('uuid')

const app = express();
const socketServer = new WebSocket.Server({ port: 3030 });

app.use(cors())
require('dotenv').config();

/**************************/
/* Kafka functions        */
/**************************/

var Producer = kafka.Producer,
  client = new kafka.KafkaClient({ kafkaHost: process.env.KAFKA_ENDPOINT }),
  producer = new Producer(client);

var send_kafka_message = (uid,image_name) => {
  let payloads = [
    { topic: process.env.KAFKA_ENDPOINT, messages: '{uid:'+ uid + ',image_name:' + image_name + '}' }
  ];

  producer.send(payloads, function (err, data) {
    console.log(data);
  });
}



/**************************/
/* S3 functions           */
/**************************/

// Create the S3 client
const AWS = require('aws-sdk');
// AWS.config.logger = console; // Debug purposes
AWS.config.update({
  region: '',
  accessKeyId: process.env.ACCESS_KEY_ID,
  secretAccessKey: process.env.SECRET_ACCESS_KEY,
  sslEnabled: (process.env.S3_ENDPOINT.includes('https') ? true : false),
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
});
const s3Endpoint = process.env.S3_ENDPOINT;
var s3 = new AWS.S3({ endpoint: s3Endpoint });


// Upload functions
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
    send_kafka_message(req.params.uid,req.files[0].key)
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