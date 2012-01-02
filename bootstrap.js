/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Diagnostics for Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2008-2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

let keyPref = "extensions.abpwatcher.startwatching_key";

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
    let stringBundle = Services.strings.createBundle("chrome://abpwatcher/locale/global.properties");
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