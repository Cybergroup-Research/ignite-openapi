module.exports = function(RED) 
{
    "use strict";
    var bodyParser = require("body-parser");
    var multer = require("multer");
    var cookieParser = require("cookie-parser");
    var getBody = require('raw-body');
    var cors = require('cors');
    var onHeaders = require('on-headers');
    var typer = require('content-type');
    var mediaTyper = require('media-typer');
    var isUtf8 = require('is-utf8');
    var hashSum = require("hash-sum");
    var UrlPattern = require('url-pattern');

    function rawBodyParser(req, res, next) {
        if (req.skipRawBodyParser) { next(); } // don't parse this if told to skip
        if (req._body) { return next(); }
        req.body = "";
        req._body = true;

        var isText = true;
        var checkUTF = false;

        if (req.headers['content-type']) {
            var contentType = typer.parse(req.headers['content-type'])
            if (contentType.type) {
                var parsedType = mediaTyper.parse(contentType.type);
                if (parsedType.type === "text") {
                    isText = true;
                } else if (parsedType.subtype === "xml" || parsedType.suffix === "xml") {
                    isText = true;
                } else if (parsedType.type !== "application") {
                    isText = false;
                } else if (parsedType.subtype !== "octet-stream") {
                    checkUTF = true;
                } else {
                    // applicatino/octet-stream
                    isText = false;
                }

            }
        }

        getBody(req, {
            length: req.headers['content-length'],
            encoding: isText ? "utf8" : null
        }, function (err, buf) {
            if (err) { return next(err); }
            if (!isText && checkUTF && isUtf8(buf)) {
                buf = buf.toString()
            }
            req.body = buf;
            next();
        });
    }
    
    var corsSetup = false;

    var corsHandler = function(req,res,next) { next(); }

    if (RED.settings.httpNodeCors) {
        corsHandler = cors(RED.settings.httpNodeCors);
        RED.httpNode.options("*",corsHandler);
    }

    function createRequestWrapper(node,req) {
        // This misses a bunch of properties (eg headers). Before we use this function
        // need to ensure it captures everything documented by Express and HTTP modules.
        var wrapper = {
            _req: req
        };
        var toWrap = [
            "param",
            "get",
            "is",
            "acceptsCharset",
            "acceptsLanguage",
            "app",
            "baseUrl",
            "body",
            "cookies",
            "fresh",
            "hostname",
            "ip",
            "ips",
            "originalUrl",
            "params",
            "path",
            "protocol",
            "query",
            "route",
            "secure",
            "signedCookies",
            "stale",
            "subdomains",
            "xhr",
            "socket" // TODO: tidy this up
        ];
        toWrap.forEach(function(f) {
            if (typeof req[f] === "function") {
                wrapper[f] = function() {
                    node.warn(RED._("httpin.errors.deprecated-call",{method:"msg.req."+f}));
                    var result = req[f].apply(req,arguments);
                    if (result === req) {
                        return wrapper;
                    } else {
                        return result;
                    }
                }
            } else {
                wrapper[f] = req[f];
            }
        });

        return wrapper;
    }

    async function createResponseWrapper(node,res) {
        var wrapper = {
            _res: res
        };
        var toWrap = [
            "append",
            "attachment",
            "cookie",
            "clearCookie",
            "download",
            "end",
            "format",
            "get",
            "json",
            "jsonp",
            "links",
            "location",
            "redirect",
            "render",
            "send",
            "sendfile",
            "sendFile",
            "sendStatus",
            "set",
            "status",
            "type",
            "vary"
        ];
        toWrap.forEach(function(f) {
            wrapper[f] = function() {
                node.warn(RED._("httpin.errors.deprecated-call",{method:"msg.res."+f}));
                var result = res[f].apply(res,arguments);
                if (result === res) {
                    return wrapper;
                } else {
                    return result;
                }
            }
        });
        return wrapper;
    }

    var corsHandler = function(req,res,next) { next(); }

    if (RED.settings.httpNodeCors) {
        corsHandler = cors(RED.settings.httpNodeCors);
        RED.httpNode.options("*",corsHandler);
    }

    function openapirouter(config) {
        RED.nodes.createNode(this, config);

        let endpoints = config.hiddenendpointsdata;
        endpoints ? endpoints = JSON.parse(endpoints) : endpoints = []
        
        //saving node endpoints data to retrive context to route request to specific endpoint
        this.hiddenendpointsdata = endpoints;
        // var nodeContext = this.context();
        // nodeContext.set("endpoints_data", JSON.stringify(endpoints));

        for (var i in endpoints){
            var current_method = endpoints[i].method.toLowerCase();
            var current_url = endpoints[i].url;
            if (current_url[0] !== '/') {
                current_url = '/'+current_url;
            }
            this.upload = false;
            // this.upload = n.upload;
            // this.swaggerDoc = n.swaggerDoc;
            var node = this;

            this.errorHandler = function(err,req,res,next) {
                node.warn(err);
                res.sendStatus(500);
            };

            this.callback = async function(req,res) {
                var msgid = RED.util.generateId();
                res._msgid = msgid;

                //retrieving endpoints data from node and routing logic
                // let endpoints_data = await nodeContext.get("endpoints_data");
                let endpoints_data = node.hiddenendpointsdata;
                // console.log(endpoints_data)
                // if(endpoints_data){
                //     endpoints_data = JSON.parse(endpoints_data);
                // }else{
                //     endpoints_data = [];
                // }

                //req parameters to match for routing
                let method = req.method;
                let url = req.path;

                // creating an array with nulls for routing
                let routingWrapper = [];
                let route_number = null;
                let j=0;
                while(j<endpoints_data.length){
                    routingWrapper.push(null);
                    
                    //searching for the output endex to divert request to
                    let url_pattern = await new UrlPattern(endpoints_data[j].url);
                    let result = url_pattern.match(url)
                    if(endpoints_data[j].method === method && (result !== null && result !== undefined)){
                        if(route_number === null){
                            route_number = j;
                        }
                    }

                    j +=1;
                }

                //routing request only if a match was found
                if(route_number !== null){

                    let msg = null;
                    if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE" || method === "OPTIONS" ) {
                        msg = {_msgid:msgid,req:req,res: await createResponseWrapper(node,res),payload:req.body};
                    } else if (method == "GET") {
                        msg = {_msgid:msgid,req:req,res: await createResponseWrapper(node,res),payload:req.query};
                    } else {
                        msg = {_msgid:msgid,req:req,res: await createResponseWrapper(node,res)};
                    }

                    routingWrapper[route_number] = msg;
                    node.send(routingWrapper);
                }
            };

            var httpMiddleware = function(req,res,next) { next(); }

            if (RED.settings.httpNodeMiddleware) {
                if (typeof RED.settings.httpNodeMiddleware === "function") {
                    httpMiddleware = RED.settings.httpNodeMiddleware;
                }
            }

            var maxApiRequestSize = RED.settings.apiMaxLength || '5mb';
            var jsonParser = bodyParser.json({limit:maxApiRequestSize});
            var urlencParser = bodyParser.urlencoded({limit:maxApiRequestSize,extended:true});

            var metricsHandler = function(req,res,next) { next(); }
            if (this.metric()) {
                metricsHandler = function(req, res, next) {
                    var startAt = process.hrtime();
                    onHeaders(res, function() {
                        if (res._msgid) {
                            var diff = process.hrtime(startAt);
                            var ms = diff[0] * 1e3 + diff[1] * 1e-6;
                            var metricResponseTime = ms.toFixed(3);
                            var metricContentLength = res.getHeader("content-length");
                            //assuming that _id has been set for res._metrics in HttpOut node!
                            node.metric("response.time.millis", {_msgid:res._msgid} , metricResponseTime);
                            node.metric("response.content-length.bytes", {_msgid:res._msgid} , metricContentLength);
                        }
                    });
                    next();
                };
            }

            var multipartParser = function(req,res,next) { next(); }
            if (this.upload) {
                var mp = multer({ storage: multer.memoryStorage() }).any();
                multipartParser = function(req,res,next) {
                    mp(req,res,function(err) {
                        req._body = true;
                        next(err);
                    })
                };
            }

            if (current_method.toLowerCase() == "get") {
                RED.httpNode.get(current_url,cookieParser(),httpMiddleware,corsHandler,metricsHandler,this.callback,this.errorHandler);
            } else if (current_method.toLowerCase() == "post") {
                RED.httpNode.post(current_url,cookieParser(),httpMiddleware,corsHandler,metricsHandler,jsonParser,urlencParser,multipartParser,rawBodyParser,this.callback,this.errorHandler);
            } else if (current_method.toLowerCase() == "put") {
                RED.httpNode.put(current_url,cookieParser(),httpMiddleware,corsHandler,metricsHandler,jsonParser,urlencParser,rawBodyParser,this.callback,this.errorHandler);
            } else if (current_method.toLowerCase() == "patch") {
                RED.httpNode.patch(current_url,cookieParser(),httpMiddleware,corsHandler,metricsHandler,jsonParser,urlencParser,rawBodyParser,this.callback,this.errorHandler);
            } else if (current_method.toLowerCase() == "delete") {
                RED.httpNode.delete(current_url,cookieParser(),httpMiddleware,corsHandler,metricsHandler,jsonParser,urlencParser,rawBodyParser,this.callback,this.errorHandler);
            }
        }

        this.on("close",function() {
            var node = this;
            this.hiddenendpointsdata.forEach(function(ep,epi, eps){
                RED.httpNode._router.stack.forEach(function(route,i,routes) {
                    if (route.route && route.route.path === ep.url && route.route.methods[ep.method.toLowerCase()]) {
                        routes.splice(i,1);
                    }
                });
            });
        });

    }

    RED.nodes.registerType('ignite-openapirouter', openapirouter);
};
