/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

Cu.import("resource://gre/modules/Services.jsm");

let {Prefs} = require("prefs");
let {WindowObserver} = require("windowObserver");
let {KeySelector} = require("keySelector");

let key = undefined;

Prefs.migrate("extensions.adblockplus.abpwatcher-startwatching_key", "startwatching_key");

let knownWindowTypes =
{
  "navigator:browser": true,
  "mail:3pane": true,
  "mail:messageWindow": true,
  __proto__: null
};

new WindowObserver({
  applyToWindow: function(window)
  {
    let type = window.document.documentElement.getAttribute("windowtype");
    if (!(type in knownWindowTypes))
      return;

    window.addEventListener("popupshowing", popupShowingHandler, false);
    window.addEventListener("popuphidden", popupHiddenHandler, false);
    window.addEventListener("keypress", keyPressHandler, false);
  },

  removeFromWindow: function(window)
  {
    let type = window.document.documentElement.getAttribute("windowtype");
    if (!(type in knownWindowTypes))
      return;

    window.removeEventListener("popupshowing", popupShowingHandler, false);
    window.removeEventListener("popuphidden", popupHiddenHandler, false);
    window.removeEventListener("keypress", keyPressHandler, false);
  }
});

function getMenuItem()
{
  // Randomize URI to work around bug 719376
  let stringBundle = Services.strings.createBundle("chrome://abpwatcher/locale/global.properties?" + Math.random());
  let result = [stringBundle.GetStringFromName("startwatching.label"), stringBundle.GetStringFromName("startwatching.accesskey")];

  getMenuItem = function() result;
  return getMenuItem();
}

function popupShowingHandler(event)
{
  let popup = event.target;
  if (!/^(abp-(?:toolbar|status|menuitem)-)popup$/.test(popup.id))
    return;

  let [label, accesskey] = getMenuItem();
  let item = popup.ownerDocument.createElement("menuitem");
  item.setAttribute("label", label);
  item.setAttribute("accesskey", accesskey);
  item.setAttribute("class", "abpwatcher-item");

  if (typeof key == "undefined")
    configureKey(event.currentTarget);
  item.setAttribute("acceltext", KeySelector.getTextForKey(key));

  item.addEventListener("command", popupCommandHandler, false);

  let insertBefore = null;
  for (let child = popup.firstChild; child; child = child.nextSibling)
    if (/-options$/.test(child.id))
      insertBefore = child;
  popup.insertBefore(item, insertBefore);
}

function popupHiddenHandler(event)
{
  let popup = event.target;
  if (!/^(abp-(?:toolbar|status|menuitem)-)popup$/.test(popup.id))
    return;

  let items = popup.getElementsByClassName("abpwatcher-item");
  while (items.length)
    items[0].parentNode.removeChild(items[0]);
}

function popupCommandHandler(event)
{
  if (!("@adblockplus.org/abp/private;1" in Cc))
    return;

  let watcherWnd = Services.wm.getMostRecentWindow("abpwatcher:watch");
  if (watcherWnd)
    watcherWnd.focus();
  else
    event.target.ownerDocument.defaultView.openDialog("chrome://abpwatcher/content/watcher.xul", "_blank", "chrome,centerscreen,resizable,dialog=no");
}

function keyPressHandler(event)
{
  if (typeof key == "undefined")
    configureKey(event.currentTarget);

  if (KeySelector.matchesKey(event, key))
  {
    event.preventDefault();
    popupCommandHandler(event);
  }
}

function configureKey(window)
{
  key = new KeySelector(window).selectKey(Prefs.startwatching_key);
}
