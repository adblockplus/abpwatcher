/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

let keyPref = "extensions.abpwatcher.startwatching_key";

function install(params, reason) {}
function uninstall(params, reason) {}

function startup(params, reason)
{
  if (Services.vc.compare(Services.appinfo.platformVersion, "10.0") < 0)
    Components.manager.addBootstrappedManifestLocation(params.installPath);

  let scope = {};
  Services.scriptloader.loadSubScript("chrome://abpwatcher/content/prefLoader.js", scope);
  scope.loadDefaultPrefs(params.installPath);

  try
  {
    // Migrate old pref
    let legacyPref = "extensions.adblockplus.abpwatcher-startwatching_key";
    if (Services.prefs.prefHasUserValue(legacyPref))
    {
      let key = Services.prefs.getCharPref(legacyPref);
      Services.prefs.setCharPref(keyPref, key);
      Services.prefs.clearUserPref(legacyPref);
    }
  }
  catch (e)
  {
    Cu.reportError(e);
  }

  WindowObserver.init();
}

function shutdown(params, reason)
{
  if (Services.vc.compare(Services.appinfo.platformVersion, "10.0") < 0)
    Components.manager.removeBootstrappedManifestLocation(params.installPath);

  WindowObserver.shutdown();

  let watcherWnd = Services.wm.getMostRecentWindow("abpwatcher:watch");
  if (watcherWnd)
    watcherWnd.close();
}

var WindowObserver =
{
  initialized: false,

  init: function()
  {
    if (this.initialized)
      return;
    this.initialized = true;

    let e = Services.ww.getWindowEnumerator();
    while (e.hasMoreElements())
      this.applyToWindow(e.getNext().QueryInterface(Ci.nsIDOMWindow));

    Services.ww.registerNotification(this);
  },

  shutdown: function()
  {
    if (!this.initialized)
      return;
    this.initialized = false;

    let e = Services.ww.getWindowEnumerator();
    while (e.hasMoreElements())
      this.removeFromWindow(e.getNext().QueryInterface(Ci.nsIDOMWindow));

    Services.ww.unregisterNotification(this);
  },

  applyToWindow: function(window)
  {
    if (!window.document.getElementById("abp-hooks"))
      return;

    window.addEventListener("popupshowing", this.popupShowingHandler, false);
    window.addEventListener("popuphiding", this.popupHidingHandler, false);
    window.addEventListener("keypress", this.keyPressHandler, false);
  },

  removeFromWindow: function(window)
  {
    if (!window.document.getElementById("abp-hooks"))
      return;
    window.removeEventListener("popupshowing", this.popupShowingHandler, false);
    window.removeEventListener("popuphiding", this.popupHidingHandler, false);
    window.removeEventListener("keypress", this.keyPressHandler, false);
  },

  observe: function(subject, topic, data)
  {
    if (topic == "domwindowopened")
    {
      let window = subject.QueryInterface(Ci.nsIDOMWindow);
      window.addEventListener("DOMContentLoaded", function()
      {
        if (this.initialized)
          this.applyToWindow(window);
      }.bind(this), false);
    }
  },

  get menuItem()
  {
    // Randomize URI to work around bug 719376
    let stringBundle = Services.strings.createBundle("chrome://abpwatcher/locale/global.properties?" + Math.random());
    let result = [stringBundle.GetStringFromName("startwatching.label"), stringBundle.GetStringFromName("startwatching.accesskey")];

    delete this.menuItem;
    this.__defineGetter__("menuItem", function() result);
    return this.menuItem;
  },

  key: undefined,

  popupShowingHandler: function(event)
  {
    let popup = event.target;
    if (!/^(abp-(?:toolbar|status|menuitem)-)popup$/.test(popup.id))
      return;

    let [label, accesskey] = this.menuItem;
    let item = popup.ownerDocument.createElement("menuitem");
    item.setAttribute("label", label);
    item.setAttribute("accesskey", accesskey);
    item.setAttribute("class", "abpwatcher-item");

    if (typeof this.key == "undefined")
      this.configureKey(event.currentTarget);
    if (this.key && this.key.text)
      item.setAttribute("acceltext", this.key.text);

    item.addEventListener("command", this.popupCommandHandler, false);

    let insertBefore = null;
    for (let child = popup.firstChild; child; child = child.nextSibling)
      if (/-options$/.test(child.id))
        insertBefore = child;
    popup.insertBefore(item, insertBefore);
  },

  popupHidingHandler: function(event)
  {
    let popup = event.target;
    if (!/^(abp-(?:toolbar|status|menuitem)-)popup$/.test(popup.id))
      return;

    let items = popup.getElementsByClassName("abpwatcher-item");
    if (items.length)
      items[0].parentNode.removeChild(items[0]);
  },

  popupCommandHandler: function(event)
  {
    let watcherWnd = Services.wm.getMostRecentWindow("abpwatcher:watch");
    if (watcherWnd)
      watcherWnd.focus();
    else
      event.target.ownerDocument.defaultView.openDialog("chrome://abpwatcher/content/watcher.xul", "_blank", "chrome,centerscreen,resizable,dialog=no");
  },

  keyPressHandler: function(event)
  {
    if (typeof this.key == "undefined")
      this.configureKey(event.currentTarget);

    if (event.defaultPrevented || !this.key)
      return;
    if (this.key.shift != event.shiftKey || this.key.alt != event.altKey)
      return;
    if (this.key.meta != event.metaKey || this.key.control != event.ctrlKey)
      return;

    if (this.key.char && (!event.charCode || String.fromCharCode(event.charCode).toUpperCase() != this.key.char))
      return;
    else if (this.key.code && (!event.keyCode || event.keyCode != this.key.code))
      return;

    event.preventDefault();
    this.popupCommandHandler(event);
  },

  configureKey: function(window)
  {
    let variants = Services.prefs.getComplexValue(keyPref, Ci.nsISupportsString).data;
    let scope = {};
    Services.scriptloader.loadSubScript("chrome://abpwatcher/content/keySelector.js", scope);
    this.key = scope.selectKey(window, variants);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupportsWeakReference, Ci.nsIObserver])
};

WindowObserver.popupShowingHandler = WindowObserver.popupShowingHandler.bind(WindowObserver);
WindowObserver.popupHidingHandler = WindowObserver.popupHidingHandler.bind(WindowObserver);
WindowObserver.popupCommandHandler = WindowObserver.popupCommandHandler.bind(WindowObserver);
WindowObserver.keyPressHandler = WindowObserver.keyPressHandler.bind(WindowObserver);
