import React, { Component } from 'react';
import './App.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import axios from 'axios';
import { w3cwebsocket as W3CWebSocket } from "websocket";
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Form from 'react-bootstrap/Form';
import ProgressBar from 'react-bootstrap/ProgressBar';
import Button from 'react-bootstrap/Button';
import FormGroup from 'react-bootstrap/FormGroup';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import Alert from 'react-bootstrap/Alert'
import Table from 'react-bootstrap/Table'
import Spinner from 'react-bootstrap/Spinner'
import { v4 as uuidv4 } from 'uuid';

class App extends Component {

  constructor(props) {
    super(props);
    this.uid = uuidv4()
    this.showSpinner = {show:false}
    if (process.env.NODE_ENV === 'development') {
      this.client = new W3CWebSocket('ws://localhost:8000?uid=' + this.uid)
    } else {
      this.client = new W3CWebSocket('ws://ws-' + window.location.hostname + '?uid=' + this.uid);
    }
    this.state = {
      selectedFile: null,
      loaded: 0,
      slides: []
    }
  }

  componentDidMount() {
    this.client.onmessage = (ms) => {
      let content = JSON.parse(ms.data)
      if (content.topic === "result") {
        this.tableUpdate(content.data.image_name, content.data.prediction, content.data.confidence)
        toast.success('New results received!')
      }

      if (content.topic === "message") {
        toast.info(content.data.message)
      }
    };
  }


  checkMimeType = (event) => {
    //getting file object
    let files = event.target.files
    //define message container
    let err = []
    // list allow mime type
    const types = ['image/png', 'image/jpeg', 'image/gif']
    // loop access array
    for (let x = 0; x < files.length; x++) {
      // compare file type find doesn't matach
      if (types.every(type => files[x].type !== type)) {
        // create error message and assign to container   
        err[x] = files[x].type + ' is not a supported format\n';
      }
    };
    for (var z = 0; z < err.length; z++) {// if message not same old that mean has error 
      // discard selected file
      toast.error(err[z])
      event.target.value = null
    }
    return true;
  }

  maxSelectFile = (event) => {
    let files = event.target.files
    if (files.length > 10) {
      const msg = 'Only 10 images can be uploaded at a time'
      event.target.value = null
      toast.warn(msg)
      return false;
    }
    return true;
  }

  checkFileSize = (event) => {
    let files = event.target.files
    let size = 2000000
    let err = [];
    for (var x = 0; x < files.length; x++) {
      if (files[x].size > size) {
        err[x] = files[x].type + 'is too large, please pick a smaller file\n';
      }
    };
    for (var z = 0; z < err.length; z++) {// if message not same old that mean has error 
      // discard selected file
      toast.error(err[z])
      event.target.value = null
    }
    return true;
  }

  onChangeHandler = event => {
    var files = event.target.files
    if (this.maxSelectFile(event) && this.checkMimeType(event) && this.checkFileSize(event)) {
      // if return true allow to setState
      this.setState({
        selectedFile: files,
        loaded: 0
      })
    }
  }

  onUploadClickHandler = () => {
    const data = new FormData()
    if (this.state.selectedFile !== null) {
      for (var x = 0; x < this.state.selectedFile.length; x++) {
        data.append('file', this.state.selectedFile[x])
      }
      this.showSpinner = {show:true}
      axios.post("/upload/" + this.uid, data, {
        onUploadProgress: ProgressEvent => {
          this.setState({
            loaded: (ProgressEvent.loaded / ProgressEvent.total * 100),
          })
        },
      })
        .then(res => { // then print response status
          toast.info('Processing starting...')
        })
        .catch(err => { // then print response status
          toast.error('upload fail')
          console.log(err)
        })
    } else {
      toast.warn('Select a file first...')
    }

  }

  tableUpdate = (image_name, prediction, confidence) => {
    console.log('updating table')
    this.showSpinner = {show:false}
    var table = document.getElementById("resultTable");
    var row = table.insertRow(1);
    var cell1 = row.insertCell(0);
    var cell2 = row.insertCell(1);
    var cell3 = row.insertCell(2);

    // Add some text to the new cells:
    cell1.innerHTML = image_name;
    cell2.innerHTML = prediction;
    cell3.innerHTML = confidence;

  }

  onTestClickHandler = () => {
    this.client.send('toto')
  }

  render() {
    return (
      <Container className="background">
        <Row>
          <Col xs={10}><h2>COVID19 Risk Assessment</h2>
            <p>
              This application allows you to submit an X-Ray image and get a risk assessment using COVID-Net models.
            </p>
            <Alert variant="warning">
              <Alert.Heading>Warning</Alert.Heading>
              <p>
                The COVID-Net models used by this application are intended to be used as reference models that can be built upon and enhanced as new data becomes available.
                They are currently at a research stage and not yet intended as production-ready models (not meant for direct clinical diagnosis), and the COVID-Net team is working continuously to improve them as new data becomes available.
                Please do not use this service for self-diagnosis and seek help from your local health authorities.
              </p>
              <hr />
              <p className="mb-0">
                Please refer to the <Alert.Link href="https://github.com/lindawangg/COVID-Net">COVID-Net project</Alert.Link> for information on the models,
                </p>
            </Alert>
          </Col>
        </Row>
        <Row>
          <Col xs={10}>
            <Form>
              <FormGroup>
                <Form.Label>Upload Your File(s), up to ten at a time</Form.Label>
                <Form.Control type="file" multiple onChange={this.onChangeHandler}></Form.Control>
              </FormGroup>
              <ToastContainer />
              <FormGroup>
                <ProgressBar max="100" color="primary" value={this.state.loaded} >{Math.round(this.state.loaded, 2)}%</ProgressBar>
              </FormGroup>
              <Button type="button" className="btn btn-primary btn-block" onClick={this.onUploadClickHandler}>Upload</Button>
            </Form></Col>
        </Row>
        <Row>
          <Col>&nbsp;</Col>
        </Row>
        <Row>
          <Col xs={10}>
            <h2>Results  {this.showSpinner.show && <Button id="btn-loading"  variant="primary" disabled>
              <Spinner
                as="span"
                animation="border"
                size="sm"
                role="status"
                aria-hidden="true"
              />
              &nbsp;Loading...
            </Button>}
            </h2>
          </Col>
        </Row>
        <Row>
          <Col xs={10}>
            <Table striped bordered hover id="resultTable">
              <thead>
                <tr>
                  <th>Image Name</th>
                  <th>Prediction</th>
                  <th>Confidence</th>
                </tr>
              </thead>
            </Table>
          </Col>
        </Row>
      </Container>


    );
  }
}


export default App;
