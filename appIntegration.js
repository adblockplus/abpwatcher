/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");

let {Prefs} = require("prefs");
let {WindowObserver} = require("windowObserver");

let AppIntegration = exports.AppIntegration =
{
  initialized: false,

  init: function()
  {
    if (this.initialized)
      return;
    this.initialized = true;

    Prefs.init("extensions.abpwatcher.", {
      "extensions.adblockplus.abpwatcher-startwatching_key": "startwatching_key"
    });
    WindowObserver.init(this);
  },

  shutdown: function()
  {
    Prefs.shutdown();
    WindowObserver.shutdown();
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
    this.key = require("keySelector").selectKey(window, Prefs.startwatching_key);
    unrequire("keySelector");   // This module is used only once, release its scope
  }
};

AppIntegration.popupShowingHandler = AppIntegration.popupShowingHandler.bind(AppIntegration);
AppIntegration.popupHidingHandler = AppIntegration.popupHidingHandler.bind(AppIntegration);
AppIntegration.popupCommandHandler = AppIntegration.popupCommandHandler.bind(AppIntegration);
AppIntegration.keyPressHandler = AppIntegration.keyPressHandler.bind(AppIntegration);
