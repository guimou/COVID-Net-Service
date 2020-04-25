FROM python:3.6

WORKDIR /usr/src/app

COPY requirements.txt inference.py  ./

RUN pip install -r requirements.txt

CMD ["python", "-u", "inference.py"]
