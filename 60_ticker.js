// ships/60_ticker.js
// Minimal tick-queue so other scripts can schedule delayed callbacks

var _Ships_timerQueue = _Ships_timerQueue || [];

global.Ships_schedule = function(server, delayTicks, fn){
  try {
    var now = (global.Ships_tickCounter ? global.Ships_tickCounter() : 0) | 0;
    var due = now + ((delayTicks|0) < 0 ? 0 : (delayTicks|0));
    _Ships_timerQueue.push({ due: due, fn: fn });
  } catch (e) {
    try { server.tell(Text.red('[Ships] schedule error: ' + e)); } catch (_) {}
  }
};

global.Ships_processTimers = function(server){
  try {
    if (!_Ships_timerQueue || _Ships_timerQueue.length === 0) return;
    var now = (global.Ships_tickCounter ? global.Ships_tickCounter() : 0) | 0;
    var rest = [];
    for (var i = 0; i < _Ships_timerQueue.length; i++) {
      var it = _Ships_timerQueue[i];
      if (!it) continue;
      if (it.due <= now) {
        try { if (typeof it.fn === 'function') it.fn(); } catch (e1) {
          try { server.tell(Text.red('[Ships] scheduled fn error: ' + e1)); } catch (_0) {}
        }
      } else {
        rest.push(it);
      }
    }
    _Ships_timerQueue = rest;
  } catch (e) {
    try { server.tell(Text.red('[Ships] processTimers error: ' + e)); } catch (_1) {}
  }
};
