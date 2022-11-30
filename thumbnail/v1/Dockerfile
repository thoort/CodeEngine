FROM icr.io/codeengine/node:12-alpine
# RUN npm install
COPY app.js .
COPY page.* .
COPY pictures/* /pictures/
EXPOSE 8080
CMD [ "node", "app.js" ]
