FROM ubuntu:22.04

RUN apt-get update 
RUN apt-get install -y curl
RUN curl -sL https://deb.nodesource.com/setup_20.x -o nodesource_setup.sh
RUN bash nodesource_setup.sh
RUN apt install -y nodejs

COPY index.js .
COPY package.json .
COPY .env .

RUN npm install

CMD ["node", "index.js"]