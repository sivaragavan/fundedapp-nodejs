
var express = require("express");
var logfmt = require("logfmt");
var app = express();
var uuid = require('node-uuid');
var rest = require("./rest.js");

//var Db = require('mongodb').Db,
//    MongoClient = require('mongodb').MongoClient,
//    Server = require('mongodb').Server,
//    ReplSetServers = require('mongodb').ReplSetServers,
//    ObjectID = require('mongodb').ObjectID,
//    Binary = require('mongodb').Binary,
//    GridStore = require('mongodb').GridStore,
//    Code = require('mongodb').Code,
//    BSON = require('mongodb').pure().BSON;
//
//var db;

var ironcache = require('iron-cache');
var iron_cache = ironcache.createClient({ project: '53ab0ea86bfde300090000c3', token: 'jOIamATE866T3I3JD6nacJ40KpE' });

var ironmq = require('iron_mq');
var iron_mq = new ironmq.Client({ project: '53ab0ea86bfde300090000c3', token: 'jOIamATE866T3I3JD6nacJ40KpE' });


app.use(logfmt.requestLogger());
app.use(express.bodyParser());

var port = Number(process.env.PORT || 5000);

// Start Server
app.listen(port, function () {
    console.log("Listening on " + port);

//    db = new Db('pointout1', new Server("ds039007.mongolab.com", 39007,
//        {auto_reconnect: false, poolSize: 4}), {w: 0, native_parser: false});
//
//
//    // Establish connection to db
//    db.open(function (err, db) {
//        db.authenticate('root', 'root', function (err, result) {
//
//        });
//    });

    //refresh();
    //setInterval(refresh, 3600000);
    //setInterval(orgUpdater, 1000);
    setInterval(fundingUpdater, 1000);
});

// Refresh API
app.get('/refresh', function (req, res) {

    refresh();

    var response = [];
    res.send({'success': true, 'response': response});
});

var current_update_time = 0;
var start_page = 1;

function refresh(page) {

    page = page || start_page;

    console.log("Refreshing : /v/2/organizations | Page : " + page);

    var options = {
        host: 'api.crunchbase.com',
        port: 80,
        path: '/v/2/organizations?user_key=64faa78375c0bbdf1626b3b282b9d932&page=' + page + '&order=updated_at+DESC',
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    rest.getJSON(options, orgListResponse);

}

function orgListResponse(statusCode, result) {

    var page = result.data.paging.current_page;

    console.log("Number of Orgs in Page " + result.data.paging.current_page + " : " + result.data.items.length);

    var last_update_time = 0;

    iron_cache.get('fundedapp-metadata', 'last_update_time',
        function (err, item) {

            if (err) { console.log(err); }

            if (item) {
                last_update_time = item.value;
                console.log("Found last_update_time :" + last_update_time);
            } else {
                return;
            }

            console.log("Pushing all orgs into orgUpdate Queue till last_update_time : " + last_update_time);

            var found = false;
            var toPush = [];

            for (var i = 0; i < result.data.items.length; i++) {
                var org = result.data.items[i];
                if(org.updated_at >= last_update_time) {
                    if(page == start_page && i == 0) {
                        current_update_time = org.updated_at;
                    }
                    console.log("Pushing Org into orgUpdate Queue : " + org.updated_at + " : " + org.name + " : " + org.path);

                    toPush.push({body : JSON.stringify({path: org.path, last_update_time: last_update_time})});

                } else {
                    found = true;
                    console.log("Done with Pushing orgs into orgUpdate Queue till last_update_time : " + last_update_time);
                    break;
                }
            }

            if(toPush.length > 0) {
                iron_mq.queue("orgUpdate").post(
                    toPush,
                    function (error, body) {
                        if(!error) {
                            console.log("Pushed Orgs to IronMQ");
                        } else {
                            console.log(error);
                        }
                    });
            }

            if (!found && result.data.paging.next_page_url) {
                setTimeout(refresh(result.data.paging.current_page + 1), 1000);
            } else if (current_update_time != 0) {
                iron_cache.put('fundedapp-metadata', 'last_update_time', { value: current_update_time }, function (err, res) {
                    if (err) {
                        console.log(res);
                    }
                });
                console.log("Updated last_update_time: ", current_update_time);
            }

        }
    );

}

function orgUpdater() {

    iron_mq.queue("orgUpdate").get({},
        function (error, body) {
            if (!error && body) {

                console.log(JSON.stringify(body));
                org = JSON.parse(body.body);

                orgPath = org.path;
                last_update_time = org.last_update_time

                var options = {
                    host: 'api.crunchbase.com',
                    port: 80,
                    path: '/v/2/' + orgPath + '?user_key=64faa78375c0bbdf1626b3b282b9d932',
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                };

                console.log("Fetching details of org : " + orgPath);

                rest.getJSON(options, orgDetailResponse);
            } else {
                console.log(error);
            }
        });
}


function orgDetailResponse(statusCode, result) {
    if (result.data.relationships.funding_rounds) {

        console.log("Number of funding rounds for : " + result.data.properties.name + ' : ' + result.data.relationships.funding_rounds.paging.total_items);

        var toPush = [];

        result.data.relationships.funding_rounds.items.forEach(function (round) {
            console.log("Pushing funding round into fundingUpdate Queue : " + round.path);
            toPush.push({body : JSON.stringify({path: round.path, org: result.data})});
        });

        if(toPush.length > 0) {
            iron_mq.queue("fundingUpdate").post(
                toPush,
                function (error, body) {
                    if(!error) {
                        console.log("Pushed fundings to IronMQ");
                    } else {
                        console.log(error);
                    }
                });
        }
    }
}



function fundingUpdater() {

    iron_mq.queue("fundingUpdate").get({},
        function (error, body) {
            if (!error && body) {

                funding = JSON.parse(body.body);

                fundingPath = funding.path;
                org = funding.org;

                var options = {
                    host: 'api.crunchbase.com',
                    port: 80,
                    path: '/v/2/' + fundingPath + '?user_key=64faa78375c0bbdf1626b3b282b9d932',
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                };

                console.log("Fetching details of funding round : " + fundingPath);

                rest.getJSON(options, function (statusCode, result) {
                    result.data["org"] = org;
                    console.log("Adding to ES: %j", result.data);
                });

            } else {
                console.log(error);
            }
        });
}


// Email Module

var nodemailer = require("nodemailer");

function sendMail(emailId, subject, body) {

    var smtpTransport = nodemailer.createTransport("SMTP", {
        service: "Gmail",
        auth: {
            user: "sivaprakash.ragavan@gmail.com",
            pass: "skE.Haj:Ly@Wop,"
        }
    });

    smtpTransport.sendMail({
        from: 'Sivaprakash Ragavan <sivaprakash.ragavan@gmail.com>', // sender address
        to: emailId, // comma separated list of receivers
        subject: subject, // Subject line
        text: body // plaintext body
    }, function (error, response) {
        if (error) {
            console.log(error);
        } else {
            console.log("Message sent: " + response.message);
        }
    });
}

// Notification Module

var apn = require('apn');

function sendIOSNotification(message, device) {

    console.log("Sending : " + message + " to " + device);

    var options = { "gateway": "gateway.sandbox.push.apple.com" };
    var apnConnection = new apn.Connection(options);

    var myDevice = new apn.Device(device);
    var note = new apn.Notification();
    note.expiry = Math.floor(Date.now() / 1000) + 3600; // Expires 1 hour from now.
    note.badge = 3;
    note.sound = "ping.aiff";
    note.alert = message;
    note.payload = {'messageFrom': 'Caroline'};
    apnConnection.pushNotification(note, myDevice);

    console.log("Sent : " + message + " to " + device);
}
