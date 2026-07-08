// sonar2024's app-specific server logic as a beatlink-core plugin. This is
// the simplest of the ported apps: no devices, no queue, no admin, no
// keep-alive — just a flat sound catalog, legacy join/leave notifications,
// and two relays. Session lifecycle, roles, and the Lobby/Veil (driven by
// the host's session-play/session-pause) all come from core with zero
// plugin code.
//
// One thing worth knowing: MIDI channel + color assignment is computed
// CLIENT-SIDE by the sequencer (on 'track joined'), then broadcast back via
// 'track data'. The server only relays it — see the `relay` map below.

module.exports = function sonarPlugin(ctx) {
    ctx.relay({
        // Host computes {socketID, channel, colors} and sends it back;
        // every other client filters for its own socketID (legacy: excludes
        // the sender since the sequencer already holds this locally).
        'track data': 'broadcast',
        // MIDI passthrough: legacy relays to the whole session INCLUDING
        // the sender (unlike chaotic-pedalboard's host-only routing).
        'midi message': 'session'
    });

    // Legacy 'track joined'/'track left', carrying `track` as the slot
    // number — this is what the sequencer's client-side track array keys on.
    ctx.onActivate((session, { slot, socketID, initials }) => {
        ctx.io.to(session.name).except(socketID).emit('track joined', {
            initials, track: slot, socketID
        });
    });

    ctx.onRelease((session, { slot, socketID, initials }) => {
        ctx.emitToSession(session.name, 'track left', { track: slot, initials, socketID });
    });

    // A joining track gets the (flat) sound catalog once, matching legacy's
    // one-shot fs.readdir on connect.
    ctx.onConnect((socket, session, role) => {
        if (role !== 'participant') return;
        const catalog = ctx.resources.get('sounds');
        socket.emit('sound-list', { list: catalog.files() });
    });
};
