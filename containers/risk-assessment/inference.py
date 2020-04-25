import io
import json
import logging
import os
import sys

import boto3
import cv2
import numpy as np
import requests
import tensorflow as tf
from tensorflow.python.lib.io import file_io

from cloudevents.sdk import marshaller
from cloudevents.sdk.event import v02

access_key = os.environ['AWS_ACCESS_KEY_ID']
secret_key = os.environ['AWS_SECRET_ACCESS_KEY']
service_point = os.environ['S3_ENDPOINT']
image_bucket = os.environ['IMAGE_BUCKET']
model_bucket = os.environ['MODEL_BUCKET']
application_url = os.environ['APPLICATION_URL']
weightspath = os.environ['WEIGHTSPATH']
metaname = os.environ['METANAME']
ckptname = os.environ['CKPTNAME']

logging.basicConfig(stream=sys.stdout, level=logging.INFO)

s3client = boto3.client('s3','us-east-1', endpoint_url=service_point,
                       aws_access_key_id = access_key,
                       aws_secret_access_key = secret_key,
                        use_ssl = True if 'https' in service_point else False)

m = marshaller.NewDefaultHTTPMarshaller()

class ForkedHTTPServer(socketserver.ForkingMixIn, http.server.HTTPServer):
    """Handle requests with fork."""


class CloudeventsServer(object):
    """Listen for incoming HTTP cloudevents requests.
    cloudevents request is simply a HTTP Post request following a well-defined
    of how to pass the event data.
    """
    def __init__(self, port=8080):
        self.port = port

    def start_receiver(self, func):
        """Start listening to HTTP requests
        :param func: the callback to call upon a cloudevents request
        :type func: cloudevent -> none
        """
        class BaseHttp(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                logging.info('POST received')
                content_type = self.headers.get('Content-Type')
                content_len = int(self.headers.get('Content-Length'))
                headers = dict(self.headers)
                data = self.rfile.read(content_len)
                data = data.decode('utf-8')
                logging.info(content_type)
                logging.info(data)

                if content_type != 'application/json':
                    logging.info('Not JSON')
                    data = io.StringIO(data)

                try:
                    event = v02.Event()
                    event = m.FromRequest(event, headers, data, json.loads)
                except Exception as e:
                    logging.error(f"Event error: {e}")
                    raise   

                logging.info(event)
                func(event)
                self.send_response(204)
                self.end_headers()
                return

        socketserver.TCPServer.allow_reuse_address = True
        with ForkedHTTPServer(("", self.port), BaseHttp) as httpd:
            try:
                logging.info("serving at port {}".format(self.port))
                httpd.serve_forever()
            except:
                httpd.server_close()
                raise

def init_tf_session(weightspath,metaname,ckptname):
    sess = tf.Session()
    tf.get_default_graph()

    meta_url = 's3://' + model_bucket + '/' + weightspath + '/' + metaname
    ckpt_url = 's3://' + model_bucket + '/' + weightspath + '/' + ckptname
    saver = tf.train.import_meta_graph(meta_url)
    saver.restore(ckpt_url)

    return sess


def prediction(bucket,key):
    mapping = {'normal': 0, 'pneumonia': 1, 'COVID-19': 2}
    inv_mapping = {0: 'normal', 1: 'pneumonia', 2: 'COVID-19'}

    sess = tf.Session()
    tf.get_default_graph()

    graph = tf.get_default_graph()

    image_tensor = graph.get_tensor_by_name("input_1:0")
    pred_tensor = graph.get_tensor_by_name("dense_3/Softmax:0")

    # Load image from S3
    obj = s3client.get_object(Bucket=bucket, Key=key)
    img_stream = io.BytesIO(obj['Body'].read())
    x = cv2.imdecode(np.fromstring(img_stream.read(), np.uint8), 1)

    h, w, c = x.shape
    x = x[int(h/6):, :]
    x = cv2.resize(x, (224, 224))
    x = x.astype('float32') / 255.0
    pred = sess.run(pred_tensor, feed_dict={image_tensor: np.expand_dims(x, axis=0)})

    data = {'prediction':inv_mapping[pred.argmax(axis=1)[0]],'confidence':'Normal: {:.3f}, Pneumonia: {:.3f}, COVID-19: {:.3f}'.format(pred[0][0], pred[0][1], pred[0][2])}

    return data

def extract_data(msg):
    logging.info('extract_data')
    uid=msg['uid']
    image_name=msg['image_name']
    data = {'uid': uid, 'image_name': image_name}
    return data


def run_event(event):
    logging.info(event.Data())
    try:
        # Retrieve info from notification
        extracted_data = extract_data(event.Data())
        uid = extracted_data['uid']
        img_key = extracted_data['bucket_object']
        logging.info('Analyzing: ' + img_key + ' for uid: ' + uid)

        # Message user that we're starting
        url = application_url + '/message?uid=' + uid + '&message=Starting analysis of image: ' + img_key 
        r =requests.get()

        # Make prediction
        result = prediction(image_bucket,img_key)

        # Send result
        url = application_url + '/result?uid=' + uid + '&image_name=' + img_key + '&prediction' + result['prediction'] + '&confidence=' + result['confidence']
        r =requests.get()

        logging.info('result=' + result['prediction'])

    except Exception as e:
        logging.error(f"Unexpected error: {e}")
        raise

# Load model
sess = init_tf_session(weightspath,metaname,ckptname)
logging.info('model loaded')

# Start event listener
client = CloudeventsServer()
client.start_receiver(run_event)
