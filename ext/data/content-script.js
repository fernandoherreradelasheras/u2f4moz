/* eslint-env browser */
/* globals cloneInto, exportFunction, unsafeWindow */
"use strict";

const DEFAULT_TIMEOUT_SECONDS = 30;

var nextCallbackID = 0;
var activeRequests = 0;
var callbacks = [];

var noopOnPage = exportFunction(() => {}, unsafeWindow);

function deliverResponse(id, payload) {
  if (!callbacks[id])
    return;

  var value = cloneInto(payload, document.defaultView);

  try {
    clearTimeout(callbacks[id].timer);
    callbacks[id].callback(value);
  } catch (ex) {
    console.info(ex + "");
  }

  if (--activeRequests == 0)
    self.port.removeListener("U2FRequestResponse", processChromeResponse);
}

function processChromeResponse(id, response) {
  if (response.errorMessage)
    console.info("U2F error response:", response.errorMessage);

  delete response.errorMessage;

  deliverResponse(id, response);
}

function handleTimeout(id) {
  deliverResponse(id, {errorCode: 5});
}

function sendToChrome(msg, callback, timeout) {
  var origin = document.location.origin;
  var callbackID = nextCallbackID++;

  timeout = 1000 * (timeout || DEFAULT_TIMEOUT_SECONDS);
  var timer = setTimeout(handleTimeout, timeout, callbackID);

  callbacks[callbackID] = {callback: callback, timer: timer};
  if (activeRequests++ == 0)
    self.port.on("U2FRequestResponse", processChromeResponse);

  self.port.emit("U2FRequest", msg, callbackID, origin, timeout);
}

function cloneFunctions(obj, clone) {
  Object.getOwnPropertyNames(obj).forEach(i => {
    if (typeof obj[i] == "function") {
      // instead of freezing the clone use accessor property to allow further extension
      let value = exportFunction(obj[i], clone);
      let getter = exportFunction(() => {
        return value;
      }, clone);
      Object.defineProperty(clone, i, {
        get: getter,
        set: noopOnPage // readonly: silently avoid strict mode TypeError on assignment
      });
    } else if (typeof obj[i] == "object") {
      cloneFunctions(obj[i], clone[i]);
    }
  });
}

var u2f = {
  register: function(requests, signRequests, callback, timeout) {
    if (typeof(timeout) == "function" && typeof(callback) != "function") {
      let appId, keys;
      [appId, requests, keys, callback, timeout] = Array.from(arguments);
      Array.forEach(requests, v => v.appId = appId);
      signRequests = Array.map(keys, v => ({
        version: v.version,
        challenge: requests[0].challenge,
        keyHandle: v.keyHandle,
        appId: appId
      }));
    }

    sendToChrome({
      type: "register",
      requests: requests,
      signRequests: signRequests
    }, callback, timeout);
  },

  sign: function(signRequests, callback, timeout, extra) {
    if (typeof(extra) == "function" && typeof(callback) != "function") {
      let appId, challenge, keys;
      [appId, challenge, keys, callback, timeout] = Array.from(arguments);
      signRequests = Array.map(keys, v => ({
        version: v.version,
        challenge: challenge,
        keyHandle: v.keyHandle,
        appId: appId
      }));
    }

    sendToChrome({
      type: "sign",
      signRequests: signRequests
    }, callback, timeout);
  }
};

exportFunction(function(){}, unsafeWindow, {
  defineAs: "u2f"
});
cloneFunctions(u2f, unsafeWindow.u2f);


var chromeOnPage = createObjectIn(unsafeWindow, {
  defineAs: "chrome"
});
var chromeRuntimeOnPage = createObjectIn(chromeOnPage, {
  defineAs: "runtime"
});

function chromeSendMessage(id, msg, callback) {
  if (id == "kmendfapggjehodndflmmgagdbamhnfd") {

    chromeRuntimeOnPage.lastError = null;
  } else
    chromeRuntimeOnPage.lastError = {
      message: "Not found"
    };
  callback();
}

function chromeConnect() {
  var msgListeners = [];
  var obj = cloneInto({
    name: "U2f",
    onMessage: { }
  }, unsafeWindow);
  exportFunction(function(msg) {
    if (msg.type == "u2f_sign_request") {
      // Remove U2F_V1 requests
      for (var i = msg.signRequests.length; i--;) {
        if (msg.signRequests[i]['version'] === 'U2F_V1') {
          msg.signRequests.splice(i, 1);
        }
      }
      u2f.sign(msg.signRequests, function(resp) {
        resp.version = "U2F_V2";
        var r = cloneInto({
          type: "u2f_sign_response",
          responseData: resp,
          requestId: msg.requestId
        }, unsafeWindow);
        for (var listener of msgListeners)
          listener(r);
      }, msg.timeoutSeconds);
    } else if (msg.type == "u2f_register_request") {
      // Remove U2F_V1 requests
      for (var i = msg.registerRequests.length; i--;) {
        if (msg.registerRequests[i]['version'] === 'U2F_V1') {
          msg.registerRequests.splice(i, 1);
        }
      }

      u2f.register(msg.registerRequests, msg.signRequests, function(resp) {
        resp.version = "U2F_V2";
        var r = cloneInto({
          type: "u2f_register_response",
          responseData: resp,
          requestId: msg.requestId
        }, unsafeWindow, { wrapReflectors: true });
        for (var listener of msgListeners)
	  console.log("Calling listener...: " + listener.toString() + " with data" + JSON.stringify(r));
          listener(r);
      }, msg.timeoutSeconds);
    } else {
    }
  }, obj, {
    defineAs: "postMessage"
  });
  exportFunction(function(listener) {
    console.log("Adding listener: " + listener.toString());
    msgListeners.push(listener);
  }, obj.onMessage, {
    defineAs: "addListener",
    allowCrossOriginArguments: true
  });
  return obj;
}

exportFunction(chromeSendMessage, chromeRuntimeOnPage, {
  defineAs: "sendMessage"
});
exportFunction(chromeConnect, chromeRuntimeOnPage, {
  defineAs: "connect"
});
