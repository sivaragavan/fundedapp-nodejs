
var express = require("express");
var logfmt = require("logfmt");
var app = express();
var uuid = require('node-uuid');
var rest = require("./rest.js");

var Db = require('mongodb').Db,
    MongoClient = require('mongodb').MongoClient,
    Server = require('mongodb').Server,
    ReplSetServers = require('mongodb').ReplSetServers,
    ObjectID = require('mongodb').ObjectID,
    Binary = require('mongodb').Binary,
    GridStore = require('mongodb').GridStore,
    Code = require('mongodb').Code,
    BSON = require('mongodb').pure().BSON;

var db;

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

    db = new Db('pointout1', new Server("ds039007.mongolab.com", 39007,
        {auto_reconnect: false, poolSize: 4}), {w: 0, native_parser: false});


    // Establish connection to db
    db.open(function (err, db) {
        db.authenticate('root', 'root', function (err, result) {

        });
    });

    refresh();
    setInterval(refresh, 3600000);
});

// Refresh API
app.get('/refresh', function (req, res) {

    refresh();

    var response = [];
    res.send({'success': true, 'response': response});
});

var current_update_time = 0;

function refresh(page) {

    page = page || 250;

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
                    if(page == 250 && i == 0) {
                        current_update_time = org.updated_at;
                    }
                    console.log("Pushing Org into orgUpdate Queue : " + org.updated_at + " : " + org.name + " : " + org.path);

                    toPush.push({body: org.path});

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
                            console.log("Pushed to IronMQ");
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

//                for (var i = 0; i < 100; i++) {
//
//                    var org = result.data.items[i];
//
//                    var options1 = {
//                        host: 'api.crunchbase.com',
//                        port: 80,
//                        path: '/v/2/' + org.path + '?user_key=64faa78375c0bbdf1626b3b282b9d932',
//                        method: 'GET',
//                        headers: {
//                            'Content-Type': 'application/json'
//                        }
//                    };
//                    console.log("Fetching details of org : " + org.name + " : " + org.path);
//                    rest.getJSON(options1,
//                        function (statusCode1, result1) {
//                            if (result1.data.relationships.funding_rounds) {
//                                console.log("Number of funding rounds for : " + result1.data.properties.name + ' : ' + result1.data.relationships.funding_rounds.paging.total_items);
//
//                                result1.data.relationships.funding_rounds.items.forEach(function (round) {
//                                    var pathItems = round.path.split("/");
//
//                                    var funding_round_id = pathItems[pathItems.length - 1];
//
//                                    console.log(funding_round_id);
//
//                                    db.collection('funding-rounds').findOne(
//                                        {uuid: funding_round_id},
//                                        function (err, item) {
//                                            if (!item) {
//
//                                                console.log("New Funding round found : " + funding_round_id);
//
//                                                var options2 = {
//                                                    host: 'api.crunchbase.com',
//                                                    port: 80,
//                                                    path: '/v/2/' + round.path + '?user_key=64faa78375c0bbdf1626b3b282b9d932',
//                                                    method: 'GET',
//                                                    headers: {
//                                                        'Content-Type': 'application/json'
//                                                    }
//                                                };
//
//                                                console.log("Fetching details of funding round : " + funding_round_id);
//                                                rest.getJSON(options2,
//                                                    function (statusCode2, result2) {
//                                                        db.collection('funding-rounds').insert(result2.data, function (err, items) {
//                                                            console.log("Added to DB: %j", result2.data);
//                                                            //sendMail("mail@sivragav.com", result2.data.properties.name, "Got Aquired");
//                                                        });
//                                                    });
//                                            }
//                                        });
//                                });
//                            }
//                        });
//                }

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
