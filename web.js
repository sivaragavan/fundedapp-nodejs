// web.js
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

app.use(logfmt.requestLogger());
app.use(express.bodyParser());


app.get('/companies/refresh', function (req, res) {

    refreshFundings();

    var response = [];
    res.send({'success': true, 'response': response});
});


var port = Number(process.env.PORT || 5000);

app.listen(port, function () {
    console.log("Listening on " + port);

    db = new Db('pointout1', new Server("ds039007.mongolab.com", 39007,
        {auto_reconnect: false, poolSize: 4}), {w: 0, native_parser: false});


    // Establish connection to db
    db.open(function (err, db) {
        db.authenticate('root', 'root', function (err, result) {

        });
    });

    refreshFundings();

    setInterval(refreshFundings, 1500000);

});


function refreshFundings() {

    console.log("\n\n\n -- Refreshing Funding Rounds -- ")

    var options = {
        host: 'api.crunchbase.com',
        port: 80,
        path: '/v/2/organizations?user_key=64faa78375c0bbdf1626b3b282b9d932&page=1&order=updated_at+DESC',
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    console.log("Fetching all orgs sorted by Created time : /v/2/organizations");

    rest.getJSON(options,
        function (statusCode, result) {

            console.log("Number of items : " + result.data.items.length);

            setTimeout(function () {

                // TODO: Instead of all items, save the last updated_time and traverse till then.
                for (var i = 0; i < result.data.items.length; i++) {

                    var org = result.data.items[i];

                    var options1 = {
                        host: 'api.crunchbase.com',
                        port: 80,
                        path: '/v/2/' + org.path + '?user_key=64faa78375c0bbdf1626b3b282b9d932',
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    };
                    console.log("Fetching details of org : " + org.name + " : " + org.path);
                    rest.getJSON(options1,
                        function (statusCode1, result1) {
                            if (result1.data.relationships.funding_rounds) {
                                console.log("Number of funding rounds for : " + result1.data.properties.name + ' : ' + result1.data.relationships.funding_rounds.paging.total_items);

                                result1.data.relationships.funding_rounds.items.forEach(function (round) {
                                    var pathItems = round.path.split("/");

                                    var funding_round_id = pathItems[pathItems.length - 1];

                                    console.log(funding_round_id);

                                    db.collection('funding-rounds').findOne(
                                        {uuid: funding_round_id},
                                        function (err, item) {
                                            if (!item) {

                                                console.log("New Funding round found : " + funding_round_id);

                                                var options2 = {
                                                    host: 'api.crunchbase.com',
                                                    port: 80,
                                                    path: '/v/2/' + round.path + '?user_key=64faa78375c0bbdf1626b3b282b9d932',
                                                    method: 'GET',
                                                    headers: {
                                                        'Content-Type': 'application/json'
                                                    }
                                                };

                                                console.log("Fetching details of funding round : " + funding_round_id);
                                                rest.getJSON(options2,
                                                    function (statusCode2, result2) {
                                                        db.collection('funding-rounds').insert(result2.data, function (err, items) {
                                                            console.log("Added to DB: %j", result2.data);
                                                            //sendMail("mail@sivragav.com", result2.data.properties.name, "Got Aquired");
                                                        });
                                                    });
                                            }
                                        });
                                });
                            }
                        });
                }
            }, 1);
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
