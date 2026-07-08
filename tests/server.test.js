const Client = require('socket.io-client');
const { server } = require('../index.js');

// Integration tests for sonar2024 on beatlink-core: the flat sound catalog,
// client-computed channel/color assignment relayed by the server, MIDI
// passthrough, and the show's minimal (no-queue) lifecycle.

describe('sonar2024 server', () => {
    let port, clients = [];

    beforeAll((done) => {
        server.logger.transports.forEach(t => { t.silent = true; });
        server.httpServer.listen(0, () => {
            port = server.httpServer.address().port;
            done();
        });
    });

    afterEach(() => {
        clients.forEach(s => s.connected && s.disconnect());
        clients = [];
        server.sessions.all().forEach(s => server.sessions.remove(s.name));
    });

    afterAll(async () => {
        await server.close();
    });

    function connect(query) {
        const socket = Client(`http://localhost:${port}`, {
            query, forceNew: true, transports: ['websocket']
        });
        clients.push(socket);
        return socket;
    }

    function waitFor(socket, event) {
        return new Promise(resolve => socket.once(event, resolve));
    }

    async function setupHost(sessionName) {
        const host = connect({ role: 'host', session: sessionName });
        await waitFor(host, 'host-accepted');
        return host;
    }

    test('joining before any sequencer ever connected is refused', async () => {
        const track = connect({ role: 'participant', session: 's0', initials: 'JP' });
        const refusal = await waitFor(track, 'session-unavailable');
        expect(refusal.reason).toBeDefined();
    });

    test('track gets the flat sound catalog and a legacy veil-on', async () => {
        await setupHost('s1');
        const track = connect({ role: 'participant', session: 's1', initials: 'JP' });
        const [list, veil] = await Promise.all([
            waitFor(track, 'sound-list'),
            waitFor(track, 'veil-on')
        ]);
        expect(list.list.length).toBeGreaterThan(0);
        expect(list.list.every(f => f.endsWith('.mp3') || f.endsWith('.wav'))).toBe(true);
        expect(list.list.some(f => f.includes('/'))).toBe(false); // flat, no groups
        expect(veil.socketID).toBeDefined();
    });

    test('sequencer receives track joined/left with the slot as `track`', async () => {
        const host = await setupHost('s2');
        const joinedPromise = waitFor(host, 'track joined');
        const track = connect({ role: 'participant', session: 's2', initials: 'JP' });
        await waitFor(track, 'veil-on');
        const trackSocketID = track.id; // capture before disconnect clears it
        const joined = await joinedPromise;
        expect(joined).toMatchObject({ initials: 'JP', socketID: trackSocketID });
        expect(typeof joined.track).toBe('number');

        const leftPromise = waitFor(host, 'track left');
        track.disconnect();
        const left = await leftPromise;
        expect(left).toMatchObject({ track: joined.track, initials: 'JP', socketID: trackSocketID });
    });

    test('track data (channel/color) is relayed to other clients but not echoed to the sender', async () => {
        const host = await setupHost('s3');
        const track1 = connect({ role: 'participant', session: 's3', initials: 'A' });
        await waitFor(track1, 'veil-on');
        const track2 = connect({ role: 'participant', session: 's3', initials: 'B' });
        await waitFor(track2, 'veil-on');

        // Listeners registered before the emission, per the batching gotcha:
        // packets in one synchronous server burst can dispatch before an
        // await's continuation would otherwise register the next listener.
        const relayedPromise = waitFor(track2, 'track data');
        const noEcho = new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 200);
            host.once('track data', () => { clearTimeout(timer); reject(new Error('echoed to sender')); });
        });

        host.emit('track data', { socketID: track1.id, channel: 3, colors: ['#fff', '#000'] });
        const relayed = await relayedPromise;
        expect(relayed).toEqual({ socketID: track1.id, channel: 3, colors: ['#fff', '#000'] });
        await noEcho; // broadcast excludes the sender
    });

    test('midi message reaches everyone in the session, including the sender', async () => {
        const host = await setupHost('s4');
        const track = connect({ role: 'participant', session: 's4', initials: 'A' });
        await waitFor(track, 'veil-on');

        const hostPromise = waitFor(host, 'midi message');
        const echoPromise = waitFor(track, 'midi message'); // session-wide relay includes sender
        track.emit('midi message', { source: 'ui', message: [0x90, 60, 127], socketID: track.id });

        const [toHost, toSender] = await Promise.all([hostPromise, echoPromise]);
        expect(toHost).toMatchObject({ message: [0x90, 60, 127] });
        expect(toSender).toMatchObject({ message: [0x90, 60, 127] });
    });

    test('host session-play/session-pause veil the room via core Lobby', async () => {
        const host = await setupHost('s5');
        const track = connect({ role: 'participant', session: 's5', initials: 'A' });
        await waitFor(track, 'veil-on');

        const playPromise = waitFor(track, 'veil-off');
        host.emit('session-play');
        await playPromise;
        expect(server.sessions.get('s5').isPlaying()).toBe(true);

        const pausePromise = waitFor(track, 'veil-on');
        host.emit('session-pause');
        await pausePromise;
        expect(server.sessions.get('s5').isPlaying()).toBe(false);
    });

    test('host disconnect destroys the session immediately', async () => {
        const host = await setupHost('s6');
        const track = connect({ role: 'participant', session: 's6', initials: 'A' });
        await waitFor(track, 'veil-on');

        const endedPromise = waitFor(track, 'session-ended');
        host.disconnect();
        const ended = await endedPromise;
        expect(ended.reason).toBe('host-disconnected');
        expect(server.sessions.get('s6')).toBeNull();
    });

    test('a second sequencer for the same session is turned away', async () => {
        await setupHost('s7');
        const second = connect({ role: 'host', session: 's7' });
        const rejection = await waitFor(second, 'host-exists');
        expect(rejection.reason).toContain('s7');
    });
});
