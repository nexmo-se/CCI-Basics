// Note: this is NOT a runnable app, it is a series of code fragments
//  intended to show the main functions used in the CCI Demo, with brief
//  explanations of what is being used and why.  It is backend server code,
//  without a GUI.

// Ok, we have converted this to the NEW Vonage NodeSDK (vs the previous Nexmo SDK).  Specifically, @vonage/server-sdk@3.5.1
// To include the Vonage library,
const { Vonage } = require('@vonage/server-sdk');

/* We are going to create a vonage object from the vonage sdk and call it "vonage",
 using credentials we can pull from the environment, or wherever you choose...

 NOTE: For simplicity's sake, this set of snippets does NOT take into account multiple simultaneous customers. This is easily
 achievable by a variety of methods (database, redis, instance variables, arrays, other), which would best be decided by your
 dev team as best suits your needs.
*/

let app_id = process.env.app_id;
let vfrom = process.env.lvn;
const connectorServer = process.env.AIBotConnection; // This is the connector for the AI-Bot (Lex in the demo)
const transcribeServer = process.env.TranscriptionSentimentConnection; // This is the connector for the Transcription/Sentiment service
let region = "US"; // Or whatever region is appropriate
var customer_call_uuid = null;
var agent_call_uuid = null;
var lex_uuid = null;
var conference = null;
let sensitivity = 2;
const phrases = "agent|representative|support|transfer";

const vonage = new Vonage({
    apiKey: process.env.key,
    apiSecret: process.env.secret,
    applicationId: process.env.app_id,
    privateKey: process.env.keyfile,
}, { debug: false } // Set to true, if you want lots of extra debug info during development
);

/* We want to set the default /answer (and /event) webhooks for the LVN to this app
 "server_url" should be set to the public url for this server 
*/
vonage.applications.updateApplication({
    id: app_id,
    name: "DEMO_APP",
    capabilities: {
        voice: {
            webhooks: {
                answer_url: {
                    address: server_url + "/answer",
                    http_method: "GET"
                },
                event_url: {
                    address: server_url + "/event",
                    http_method: "POST"
                }
            },
        },
    }
}).then(result => {
    console.log(result.capabilities.voice);
}).catch(error => {
    console.error(error);
}
);

/* In the original Demo, for simplicity of demoing, we give the GUI a button to connect the call 
   rather than requiring the demonstrator to dial into the service.  When they press the button, this gets called...
   It simply fires off a PSTN call to the indicated cell phone, setting the /answer webhook to point back to our app
   This ends up acting just as if the user dialed the LVN directly; it is merely here for convenience in the demo
*/
app.post('/connect', async (req, res) => {
    let phone = req.body.phone;  // THe phone number of the customer, passed in from the GUI
    vonage.voice.createOutboundCall({
        to: [{
            type: 'phone',
            number: phone
        }],
        from: {
            type: 'phone',
            number: vfrom
        },
        answer_url: [server_url + '/answer'],
        event_url: [server_url + '/event']
    })
        .then(resp => console.log(resp))
        .catch(err => console.error(err));

    return res.status(200).end();
});

/* Ok, so now a call comes into the LVN (the number stored in the vfrom variable).  the /answer webhook gets called,
   and we use the passed in uuid for this call leg as a general identifier for the whole call (just for convenience...
   you could use any unique identifier, really)
   We also set the answer and event webhooks for THIS specific websocket connection, as /lex_answer and /lex_event
*/
app.get('/answer', (req, res) => {
    customer_call_uuid = req.query.uuid;
    /* Now, we want to hook this incoming call up to the Lex bot (or whichever AI bot you use)
       This app uses the "connectorServer" that Tony developed to handle the websocket-to-Lex (or other service),
       and calls us back at the indicated webhook (server+"/lex") with the transcriptions/results.
    */
    vonage.voice.createOutboundCall({
        to: [{
            type: 'websocket',
            uri: connectorServer + "/bot/DentistAppointment/alias/prod/user/" + customer_call_uuid + "_" + req.query.from + "/content",
            'content-type': 'audio/l16;rate=8000',
            headers: {
                aws_key: awsKey,
                aws_secret: awsSecret,
                client_id: req.query.uuid + "_" + req.query.from,
                webhook_url: server_url + "/lex?cuuid=" + customer_call_uuid,
                sensitivity: 2  // Voice activity detection, possible values 0 (most sensitive) to 3 (least sensitive)
            }
        }],
        from: {
            type: 'phone',
            number: vfrom
        },
        answer_url: [server_url + '/lex_answer?cuuid=' + customer_call_uuid],
        event_url: [server_url + '/lex_event?cuuid=' + customer_call_uuid]
    })
        .then(resp => console.log(resp))
        .catch(err => console.error(err));
    /* Now, we always need to respond to an /answer webhook with an NCCO.
       This one will say "Connecting" back to the user, then add the customer leg of the call into the conversation called "conference"
       It alse tells Vonage to start the conference now, and also to shut everything down when this customer hangs up
       It returns the NCCO along with status 200ok
    */
    let voice = 'Kimberly';
    let phrase = 'Connecting';
    conference = "conference_" + customer_call_uuid;
    let nccoResponse = [
        {
            action: "talk",
            text: phrase,
            voice_name: voice
        },
        {
            "action": "conversation",
            "name": conference,
            "startOnEnter": true,
            "endOnExit": true,
        }
    ];
    res.status(200).json(nccoResponse);
});

/* When the webhook gets connected (answered), this webhook gets called
   It will play a "hello" into the Lex bot, to let it know someone is there,
   and it will return the NCCO that puts the webhook into the same conversation
   as the customer.
*/
app.get('/lex_answer', (req, res) => {
    let voice = 'Kimberly';
    let phrase = 'Hello';
    lex_uuid = req.query.uuid;

    vonage.voice.playTTS(lex_uuid,
        {
            action: "talk",
            text: phrase,
            voice_name: voice,
            loop: 1,
            style: 0,
        })
        .then(resp => console.log(resp))
        .catch(err => console.error(err));
    let nccoResponse = [
        {
            "action": "conversation",
            "name": conference
        }
    ];
    res.status(200).json(nccoResponse);
});

/* We now have the customer hooked up with the Lex AI bot.  We told the Lex Connector to send all 
   the results (phrases and sentiment) back to us at our Lex webhook /lex
   We can send this info back up to the GUI, to be displayed and graphed and whatever needs to be done
   for your application.  In addition, we "listen" for key phrases that we use to tell us to
   end the AI-Bot, and connect the customer to a Live Agent.
*/
app.post('/lex', (req, res) => {
    let chatobj = {
        src_entity: 'customer',
        dst_entity: 'bot',
        channel: 'voice',
        text: req.body.customer_msg
    };
    sendChat(chatobj);  // Not shown in this app... this is where you would do whatever you want with the text transcription
    let chatobj2 = {
        src_entity: 'bot',
        dst_entity: 'customer',
        channel: 'voice',
        text: req.body.bot_msg
    };
    sendChat(chatobj2);
    /* Similarly, we are given the Sentiment of the text back in this webhook, so take the Customer
       sentiment and process it accordingly (send to GUI, or whatever).  Again, implementation not shown
       for the sake of brevity and focus
    */
    analyzeSentimentOfText(req.body.customer_msg, req.body.customer_sentiment, 'customer'); // Not shown in this app...

    /* Here, we compare what the customer is saying to our "key phrases", and transfer the call if warranted
    */
    var rx = new RegExp(phrases, 'i');
    if (rx.test(req.body.customer_msg) || req.body.bot_msg.includes(endphrase)) {
        // At least one match... so Transfer to Agent!!!
        transfer();
    }
    res.status(200).end();
})

/* The transfer() function will connect the customer to the live agent and hang up the Lex AI bot leg.
   This assumes the agent/CC is SIP.  This could be done with PSTN as well, but then call information
   would need to be passed into the CC in some other method than SIP Headers.
*/
function transfer(uid) {
    to = {
        type: "sip",
        uri: agent,  // This is the SIP URI of the CC/Agent.
        headers: { "User-to-User": customer_call_uuid + ';encoding=ascii' }
    }
    vonage.voice.createOutboundCall({
        to: [to],
        from: {
            type: 'phone',
            number: vfrom
        },
        answer_url: [server_url + '/agent_answer?original_call_uuid=' + customer_call_uuid],  // Set the answer URL specific for this leg
        event_url: [server_url + '/agent_event?original_call_uuid=' + customer_call_uuid]
    })
        .then(resp => console.log(resp))
        .catch(err => console.error(err));
    let voice = 'Kimberly';
    let phrase = 'Connecting you to an agent';

    vonage.voice.playTTS(ncustomer_call_uuid, { text: phrase, voice_name: voice, loop: 1 })
        .then(resp => console.log(resp))
        .catch(err => console.error(err));

    // Hangup lex, if still there:
    if (lex_uuid && lex_uuid.length) {
        console.log("Hanging up Lex side...");
        vonage.voice.hangupCall(lex_uuid);
        lex_uuid = null;
    }
}
/*  When the call gets answered by the Agent, we get the agent_answer webhook,
    where we can then create websockets for each leg (customer and agent)
*/
app.get('/agent_answer', (req, res) => {
    agent_call_uuid = req.query.uuid; // Keep track of this leg's uuid, for the agent leg
    setTimeout(() => {
        // Connect the websockets. We need one for the agent, and a new one for the customer
        connectSockets();
    }, 500);
    // Add this leg into the conversation...
    let nccoResponse =
        [
            {
                "action": "conversation",
                "name": conference,
            }
        ];
    res.status(200).json(nccoResponse);
});

/* The connectSockets function creates new websockets for both the customer and the agent, and hooks
   them up with the appropriate Transcription/Sentiment connectors
*/
function connectSockets(uid) {
    // Websocket associated with Client side
    let lang = 'en-us';
    let ws_url = transcribeServer;
    let rate = '8000';
    vonage.voice.createOutboundCall({
        to: [{
            type: 'websocket',
            uri: ws_url,
            'content-type': 'audio/l16;rate=' + rate,
            headers: {
                aws_key: awsKey,
                aws_secret: awsSecret,
                aws_region: "us-east-1",
                client_id: customer_call_uuid + "_" + vfrom,
                webhook_url: server_url + "/transcription?target=agent&source=customer",
                sensitivity: sensitivity,  // Voice activity detection, possible values 0 (most sensitive) to 3 (least sensitive)
                entity: 'customer',
                languageCode: lang,
            }
        }],
        from: {
            type: 'phone',
            number: vfrom // cannot use a longer than 15-digit string (e.g. not call_uuid)
        },
        answer_url: [server_url + '/customer_ws2_answer'],
        event_url: [server_url + '/customer_ws2_event']
    })
        .then(resp => console.log(resp))
        .catch(err => console.error(err));
    // Websocket associated with Agent side
    //Now do the agent side...

    vonage.voice.createOutboundCall({
        to: [{
            type: 'websocket',
            uri: ws_url,
            'content-type': 'audio/l16;rate=' + rate,
            headers: {
                aws_key: awsKey,
                aws_secret: awsSecret,
                aws_region: "us-east-1",
                client_id: agent_call_uuid + "_" + vfrom,
                webhook_url: server_url + "/transcription?target=customer&source=agent",
                sensitivity: sensitivity,  // Voice activity detection, possible values 0 (most sensitive) to 3 (least sensitive)
                entity: 'agent',
                languageCode: lang,
            }
        }],
        from: {
            type: 'phone',
            number: vfrom
        },
        answer_url: [server_url + '/agent_ws_answer?agent_uuid=' + agent_call_uuid + '&original_call_uuid=' + customer_call_uuid],
        event_url: [server_url + '/customer_ws2_event']
    })
        .then(resp => console.log(resp))
        .catch(err => console.error(err));
}

/* We have pointed these websocket answer webhooks to /customer_ws2_answer and /agent_ws_answer
   So let's create those, and set them up correctly (putting them into our conference)
   AND.. very importantly, making sure the websoket ONLY listens to the correct stream, using canHear
*/
app.get('/customer_ws2_answer', (req, res) => {
    let nccoResponse =
        [
            {
                "action": "conversation",
                "name": conference,
                "canHear": [customer_call_uuid]
            }
        ];
    res.status(200).json(nccoResponse);
});
app.get('/agent_ws_answer', (req, res) => {
    let nccoResponse =
        [
            {
                "action": "conversation",
                "name": conference,
                "canHear": [agent_call_uuid]
            }
        ];
    res.status(200).json(nccoResponse);
});

/* We told our Transcription/Sentiment connectors to send all the results to our webhook, /transcription
   Part of this url and the parameters we indicated, was to show which leg it was coming from so that we could
   differentiate what the Customer is saying from what the Agent is saying.  We take this information,
   and do with it whatever our application needs (in the Demo case, pushes the info up to the GUI for displaying
   on the chat widget and the sentiment graph)
*/
app.post('/transcription', (req, res) => {
    let client = req.body.client_id;
    let target = req.query.target;
    let source = req.query.source;
    console.log("target = " + target + ", source = " + source);
    let chatobj = {
        src_entity: source,
        dst_entity: target,
        channel: 'voice',
        text: req.body.transcript,
        sentiment: req.body.sentiment, // This is a Sentiment object, though the format may vary depending on the underlying engine
    };
    sendChat(chatobj);  // Not shown in this app... this is where you would do whatever you want with the text transcription
    res.status(200).end();
})

