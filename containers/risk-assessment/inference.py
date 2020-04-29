import io
import logging
import os
import sys
from contextlib import contextmanager

import boto3
import cv2
import numpy as np
import redis
import requests
import tensorflow as tf
from celery import Celery
from flask import Flask, jsonify, make_response, request
from waitress import serve

# Set logging
logging.basicConfig(stream=sys.stdout, level=logging.INFO)

# General Variables
access_key = os.environ['AWS_ACCESS_KEY_ID']
secret_key = os.environ['AWS_SECRET_ACCESS_KEY']
service_point = os.environ['S3_IMAGES_ENDPOINT']
image_bucket = os.environ['IMAGE_BUCKET']
model_bucket = os.environ['MODEL_BUCKET']
application_url = os.environ['APPLICATION_URL']
weightspath = os.environ['WEIGHTSPATH']
metaname = os.environ['METANAME']
ckptname = os.environ['CKPTNAME']
redis_host = os.environ['REDIS_HOST']
redis_port = os.environ['REDIS_PORT']
redis_password = os.environ['REDIS_PASSWORD']
model_loaded = False
model_loading = False

# TF initialization and variables
mapping = {'normal': 0, 'pneumonia': 1, 'COVID-19': 2}
inv_mapping = {0: 'normal', 1: 'pneumonia', 2: 'COVID-19'}
meta_url = 's3://' + model_bucket + '/' + weightspath + '/' + metaname
ckpt_url = 's3://' + model_bucket + '/' + weightspath + '/' + ckptname

# S3 connection to retrieve image
s3client = boto3.client('s3','us-east-1', endpoint_url=service_point,
                       aws_access_key_id = access_key,
                       aws_secret_access_key = secret_key,
                        use_ssl = True if 'https' in service_point else False)

# Redis client used to make a lock to ensure celery executes only one task at a time (for model loading)
redis_client = redis.Redis(host=redis_host, port=redis_port, password=redis_password)

class Model(object):
    def __init__(self,meta_url,ckpt_url):
        self.sess = tf.compat.v1.Session()
        tf.compat.v1.get_default_graph()
        
        saver = tf.compat.v1.train.import_meta_graph(meta_url)
        saver.restore(self.sess,ckpt_url)
        
        graph = tf.compat.v1.get_default_graph()
    
        self.image_tensor = graph.get_tensor_by_name("input_1:0")
        self.pred_tensor = graph.get_tensor_by_name("dense_3/Softmax:0")
        logging.info('model initialized')
    
    def prediction(self,bucket,key):    
        # Load image from S3 and prepare it
        logging.info('load image')
        obj = s3client.get_object(Bucket=bucket, Key=key)
        img_stream = io.BytesIO(obj['Body'].read())
        x = cv2.imdecode(np.fromstring(img_stream.read(), np.uint8), 1)
    
        h, w, c = x.shape
        x = x[int(h/6):, :]
        x = cv2.resize(x, (224, 224))
        x = x.astype('float32') / 255.0
    
        # Make prediction
        logging.info('make prediction')
        pred = self.sess.run(self.pred_tensor, feed_dict={self.image_tensor: np.expand_dims(x, axis=0)})

        # Format data
        data = {'prediction':inv_mapping[pred.argmax(axis=1)[0]],'confidence':'Normal: {:.3f}, Pneumonia: {:.3f}, COVID-19: {:.3f}'.format(pred[0][0], pred[0][1], pred[0][2])}
        logging.info(data)
    
        return data


def send_message(uid,message):
    url = application_url + '/message?uid=' + uid + '&message=' + message
    r =requests.get(url)

app = Flask(__name__)
model = None

# Launch Celery for deferred actions
celery = Celery(app.name, broker='redis://' + redis_host + ':' + redis_port + '/0')    
celery.conf.update(app.config)

@contextmanager
def redis_lock(lock_name):
    """Yield 1 if specified lock_name is not already set in redis. Otherwise returns 0.

    Enables sort of lock functionality.
    """
    status = redis_client.set(lock_name, 'lock', nx=True)
    try:
        yield status
    finally:
        redis_client.delete(lock_name)


@celery.task(bind=False)
def process(uid,img_key):
    global model, model_loaded

    with redis_lock('my_lock') as acquired:
        if not model_loaded:
            send_message(uid,'Loading the model, please wait a few seconds...')
            # Load model
            model = Model(meta_url,ckpt_url)
            model_loaded = True
            send_message(uid,'Model loaded!')
            
        logging.info('Analyzing: ' + img_key + ' for uid: ' + uid)

        # Message user that we're starting
        send_message(uid,'Starting analysis of image: ' + img_key)

        # Make prediction
        result = model.prediction(image_bucket,img_key)
        logging.info('result=' + result['prediction'])

        # Send result
        url = application_url + '/result?uid=' + uid + '&image_name=' + img_key + '&prediction=' + result['prediction'] + '&confidence=' + result['confidence']
        r =requests.get(url) 

@app.route('/', methods=['POST'])
def get_post():
    data = request.get_json()['data']
    uid = data['uid']
    img_key = data['image_name']
    process(uid,img_key)
    return make_response(jsonify({'msg': 'Image processing...'}), 201) 

serve(app, host="0.0.0.0", port=8080)   
