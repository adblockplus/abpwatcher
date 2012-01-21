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

let addonData = null;

function install(params, reason) {}
function uninstall(params, reason) {}

function startup(params, reason)
{
  if (Services.vc.compare(Services.appinfo.platformVersion, "10.0") < 0)
    Components.manager.addBootstrappedManifestLocation(params.installPath);

  addonData = params;
  Services.obs.addObserver(RequireObserver, "abpwatcher-require", true);

  require("appIntegration").AppIntegration.init();
}

function shutdown(params, reason)
{
  require("appIntegration").AppIntegration.shutdown();

  let watcherWnd = Services.wm.getMostRecentWindow("abpwatcher:watch");
  if (watcherWnd)
    watcherWnd.close();

  let aboutWnd = Services.wm.getMostRecentWindow("abpwatcher:about");
  if (aboutWnd)
    aboutWnd.close();

  Services.obs.removeObserver(RequireObserver, "abpwatcher-require");
  addonData = null;
  require.scopes = {__proto__: null};

  if (Services.vc.compare(Services.appinfo.platformVersion, "10.0") < 0)
    Components.manager.removeBootstrappedManifestLocation(params.installPath);
}

function require(module)
{
  let scopes = require.scopes;
  if (!(module in scopes))
  {
    if (module == "info")
    {
      scopes[module] = {};
      scopes[module].exports =
      {
        addonID: addonData.id,
        addonVersion: addonData.version,
        addonRoot: addonData.resourceURI.spec,
      };
    }
    else
    {
      scopes[module] = {require: require, unrequire: unrequire, exports: {}};
      Services.scriptloader.loadSubScript(addonData.resourceURI.spec + module + ".js", scopes[module]);
    }
  }
  return scopes[module].exports;
}
require.scopes = {__proto__: null};

function unrequire(module)
{
  delete require.scopes[module];
}

let RequireObserver =
{
  observe: function(subject, topic, data)
  {
    if (topic == "abpwatcher-require")
    {
      subject.wrappedJSObject.exports = require(data);
    }
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupportsWeakReference, Ci.nsIObserver])
};
