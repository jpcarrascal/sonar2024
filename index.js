const path = require('path');
const express = require('express');
const { createServer } = require('beatlink-core');
const config = require('./scripts/config.js');
const sonarPlugin = require('./server/sonarPlugin.js');

const server = createServer({
    roles: ['host', 'participant'],
    session: {
        numParticipants: config.NUM_TRACKS,
        allocation: 'random',
        // Legacy: host disconnect clears the session immediately, and a
        // track can't join until a sequencer has created it.
        hostDisconnect: 'destroy',
        hostOptional: false,
        turnTaking: { count: 'none' } // rounds were never actually enforced in legacy
    },
    // Flat sound directory (no sub-groups), unlike count-me-in/dbass.
    resources: {
        sounds: { dir: path.join(__dirname, 'sounds'), ext: ['.mp3', '.wav'] }
    },
    plugins: [sonarPlugin],
    logging: { label: 'sonar2024' }
});

const { app } = server;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'html/index-sequencer.html'));
});

app.get('/sequencer', (req, res) => {
    const page = req.query.session ? 'html/sequencer.html' : 'html/index-sequencer.html';
    res.sendFile(path.join(__dirname, page));
});

app.get('/track', (req, res) => {
    res.sendFile(path.join(__dirname, 'html/track.html'));
});

app.get('/latency', (req, res) => {
    res.sendFile(path.join(__dirname, 'html/latency.html'));
});

app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'images/favicon.ico'));
});

app.use('/scripts', express.static(path.join(__dirname, 'scripts')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/sounds', express.static(path.join(__dirname, 'sounds')));

if (require.main === module) {
    server.listen(process.env.PORT || 3000);
}

module.exports = { server };
