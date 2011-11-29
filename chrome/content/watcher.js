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
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);
Cu.import(baseURL.spec + "Utils.jsm");
Cu.import(baseURL.spec + "ContentPolicy.jsm");
Cu.import(baseURL.spec + "RequestNotifier.jsm");
Cu.import(baseURL.spec + "FilterClasses.jsm");

let PolicyPrivate = Cu.import(baseURL.spec + "ContentPolicy.jsm", null).PolicyPrivate;
var origShouldLoad = PolicyPrivate.shouldLoad;
var origProcessNode = Policy.processNode;

var currentData = null;
var processingQueue = [];
var stringBundle;
var notifier = null;

let clipboardHelper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);

function init()
{
  stringBundle = document.getElementById("stringbundle-global");

  let list = document.getElementById("list");
  list.view = treeView;
  list.focus();

  treeView.addObserver(updateProcessingTime);
  updateProcessingTime(treeView, "refresh");

  // Make sure the tree view has correct filters
  document.getElementById("ignore-early").doCommand();
  document.getElementById("filterText").doCommand();

  notifier = new RequestNotifier(null, handleFilterHit);

  PolicyPrivate.shouldLoad = replacementShouldLoad;
  Policy.processNode = replacementProcessNode;
  setInterval(processQueue, 200);
}

function E(id)
{
  return document.getElementById(id);
}

function replacementShouldLoad(contentType, contentLocation, requestOrigin, node, mimeTypeGuess, extra)
{
  let startTime = null;
  try
  {
    currentData = {internal: false, earlyReturn: true, filters: []};
    startTime = Date.now();

    if (contentLocation)
      currentData.location = contentLocation.spec;
    if (requestOrigin)
      currentData.origin = requestOrigin.spec;

    currentData.type = contentType;
  } catch(e) {}

  let ret;
  try
  {
    ret = origShouldLoad.apply(this, arguments);
    return ret;
  }
  finally
  {
    if (startTime !== null)
      currentData.processingTime = (Date.now() - startTime);
    currentData.result = (ret == Ci.nsIContentPolicy.ACCEPT);

    processingQueue.push(currentData);
    currentData = null;
  }
}

function replacementProcessNode(wnd, node, contentType, location, collapse)
{
  let startTime = null;
  try
  {
    if (currentData && !("context" in currentData))
    {
      currentData.earlyReturn = false;
      currentData.context = node;
      currentData.window = wnd;
      currentData.internalType = contentType;
      if (location)
          currentData.internalLocation = location.spec;
    }
    else
    {
      // shouldLoad wasn't called - this isn't being called by content policy
      let locationString = (location instanceof Filter ? location.text : location.spec);

      currentData = {
        internal: true,
        earlyReturn: false,
        filters: [],
        location: locationString,
        internalLocation: locationString,
        context: node,
        window: wnd,
        type: contentType,
        internalType: contentType
      };
      startTime = Date.now();
    }
  }
  catch(e)
  {
    Cu.reportError(e);
  }
  
  let ret;
  try
  {
    ret = origProcessNode.apply(this, arguments);
    return ret;
  }
  finally
  { 
    if (startTime !== null)
    {
      currentData.processingTime = (Date.now() - startTime);
      currentData.result = (ret == true);

      processingQueue.push(currentData);
      currentData = null;
    }
  }
}

function destroy()
{
  if (notifier)
    notifier.shutdown();
  if (origShouldLoad)
    PolicyPrivate.shouldLoad = origShouldLoad;
  if (origProcessNode)
    Policy.processNode = origProcessNode;
}

function handleFilterHit(wnd, node, data)
{
  if (data.filter && currentData)
    currentData.filters.push(data.filter.text);
}

function processQueue()
{
  if (!processingQueue.length)
    return;

  for each (let entry in processingQueue)
  {
    entry.cols = {};
    if (typeof entry.location != "undefined")
      entry.cols.address = String(entry.location);
    if (typeof entry.type != "undefined")
    {
      entry.cols.type = String(entry.type);
      try {
        // Nasty hack: try to get type name from ABP
        if (entry.type in Policy.localizedDescr)
          entry.cols.type = String(Policy.localizedDescr[entry.type]);
      } catch(e) {}
    }
    entry.cols.result = stringBundle.getString(entry.result ? "decision.allow" : "decision.block");
    if (typeof entry.context != "undefined")
      entry.cols.context = (entry.context ? getNodeLabel(entry.context) : String(entry.context));
    if (typeof entry.window != "undefined")
      entry.cols.document = (entry.window ? getNodeLabel(entry.window) : String(entry.window));
    if (typeof entry.origin != "undefined")
      entry.cols.origin = String(entry.origin);
    if (entry.filters.length)
      entry.cols.filter = entry.filters.join(", ");
    if (typeof entry.processingTime != "undefined")
      entry.cols.time = String(entry.processingTime);

    let additional = [];
    if (entry.internal)
      additional.push(stringBundle.getString("additional.internalInvocation"));
    if (typeof entry.internalType != "undefined" && entry.type != entry.internalType)
    {
      let internalType = String(entry.internalType);
      try {
        // Nasty hack: try to get type name from ABP
        if (entry.internalType in Policy.localizedDescr)
          internalType = String(Policy.localizedDescr[entry.internalType]);
      } catch(e) {}
      additional.push(stringBundle.getFormattedString("additional.typeChanged", [internalType]));
    }
    if (typeof entry.internalLocation != "undefined" && entry.location != entry.internalLocation)
      additional.push(stringBundle.getFormattedString("additional.locationChanged", [String(entry.internalLocation)]));

    if (additional.length > 0)
      entry.cols.additional = additional.join(", ");

    treeView.add(entry);
  }

  processingQueue = [];
}

function getNodeLabel(node)
{
  if (node instanceof Ci.nsIDOMWindow)
    return stringBundle.getFormattedString("NodeLabel.window", [node.location.href]);
  if (node instanceof Ci.nsIDOMDocument)
    return stringBundle.getFormattedString("NodeLabel.document", [node.URL]);
  else if (node instanceof Ci.nsIDOMXULElement)
    return stringBundle.getFormattedString("NodeLabel.xulElement", [node.tagName]);
  else if (node instanceof Ci.nsIDOMHTMLElement)
    return stringBundle.getFormattedString("NodeLabel.htmlElement", [node.tagName]);
  else if (node instanceof Ci.nsIDOMSVGElement)
    return stringBundle.getFormattedString("NodeLabel.svgElement", [node.tagName]);
  else if (node instanceof Ci.nsIDOMElement)
    return stringBundle.getFormattedString("NodeLabel.element", [node.tagName]);
  else
    return stringBundle.getFormattedString("NodeLabel.unknown", [String(node)]);
}

function fillInTooltip(event)
{
  let entry = treeView.getEntryAt(event.clientX, event.clientY);
  if (!entry)
    return false;

  let rows = document.getElementById("tooltip-rows");
  while (rows.firstChild)
    rows.removeChild(rows.firstChild);

  let cols = document.getElementById("list").getElementsByTagName("treecol");
  for (let i = 0; i < cols.length; i++)
  {
    let col = cols[i].id;
    if (col && col in entry.cols)
    {
      let row = document.createElement("row");

      let label = document.createElement("description");
      label.setAttribute("class", "tooltip-label");
      label.setAttribute("value", cols[i].getAttribute("label"));
      row.appendChild(label);

      let value = document.createElement("vbox");
      setMultilineContent(value, entry.cols[col]);
      row.appendChild(value);

      rows.appendChild(row);
    }
  }

  return true;
}

function updateContextMenu(event)
{
  let entry = treeView.getCurrentEntry();
  if (!entry)
    return false;

  E("context-copylocation").disabled = !entry.location;
  E("context-copyfilters").disabled = !entry.filters.length;
  return true;
}

function copyLocation()
{
  let entry = treeView.getCurrentEntry();
  if (entry && entry.location)
    clipboardHelper.copyString(String(entry.location));
}

function copyFilters()
{
  let entry = treeView.getCurrentEntry();
  if (entry && entry.filters.length)
    clipboardHelper.copyString(entry.filters.join("\n"));
}

function setMultilineContent(box, text) {
  // The following is sufficient in Gecko 1.9 but Gecko 1.8 fails on multiline
  // text fields in tooltips
  // box.textContent = text.replace(/\S{80}(?=\S)/g, "$& ");

  for (let i = 0; i < text.length; i += 80) {
    let description = document.createElement("description");
    description.setAttribute("value", text.substr(i, 80));
    box.appendChild(description);
  }
}

var totalProcessingTime = 0;
function updateProcessingTime(view, operation, entry)
{
  if (operation == "add")
    totalProcessingTime += entry.processingTime;
  else {
    totalProcessingTime = 0;
    for each (let entry in view.displayedItems)
      totalProcessingTime += entry.processingTime;
  }

  let numItems = view.displayedItems.length;

  let summary = document.getElementById("summary");
  let template = summary.getAttribute("_template");
  summary.textContent = template.replace(/\*NUMITEMS\*/g, numItems).replace(/\*TIME\*/, (totalProcessingTime / 1000).toFixed(3));
}

var treeView = {
  currentItems: [],
  displayedItems: [],
  _ignoreEarlyReturns: false,
  _filterString: "",
  _sortColumn: null,
  _sortDirection: null,
  boxObject: null,
  atoms: {},
  observers: [],

  //
  // nsISupports implementation
  //

  QueryInterface: function(uuid) {
    if (!uuid.equals(Ci.nsISupports) &&
        !uuid.equals(Ci.nsITreeView))
    {
      throw Cr.NS_ERROR_NO_INTERFACE;
    }
  
    return this;
  },
 
  //
  // nsITreeView implementation
  //

  selection: null,

  setTree: function(boxObject)
  {
    if (!boxObject)
      return;

    this.boxObject = boxObject;

    let atomService = Cc["@mozilla.org/atom-service;1"].getService(Ci.nsIAtomService);
    for each (let col in ["address", "type", "result", "context", "document", "origin", "additional", "filter", "time"])
    {
      let atomStr = "col-" + col;
      this.atoms[atomStr] = atomService.getAtom(atomStr);
    }
    for each (let flag in ["selected", "blocked"])
    {
      let atomStr = flag + "-true";
      this.atoms[atomStr] = atomService.getAtom(atomStr);

      atomStr = flag + "-false";
      this.atoms[atomStr] = atomService.getAtom(atomStr);
    }

    // Check current sort direction
    let cols = document.getElementsByTagName("treecol");
    for (let i = 0; i < cols.length; i++)
    {
      let col = cols[i];
      let dir = col.getAttribute("sortDirection");
      if (dir && dir != "natural")
      {
        this._sortColumn = col.id;
        this._sortDirection = dir;
      }
    }
  },

  get rowCount()
  {
    return this.displayedItems.length;
  },

  getCellText: function(row, col)
  {
    col = col.id;

    if (row < 0 || row >= this.displayedItems.length)
      return "";

    let entry = this.displayedItems[row];
    return (col in entry.cols ? entry.cols[col] : null);
  },

  getColumnProperties: function(col, properties)
  {
    col = col.id;

    if ("col-" + col in this.atoms)
      properties.AppendElement(this.atoms["col-" + col]);
  },
  getRowProperties: function(row, properties)
  {
    if (row < 0 || row >= this.displayedItems.length)
      return;

    properties.AppendElement(this.atoms["selected-" + this.selection.isSelected(row)]);

    let entry = this.displayedItems[row];
    properties.AppendElement(this.atoms["blocked-" + !entry.result]);
  },
  getCellProperties: function(row, col, properties)
  {
    this.getColumnProperties(col, properties);
    this.getRowProperties(row, properties);
  },

  cycleHeader: function(col)
  {
    col = col.element;

    let cycle =
    {
      natural: 'ascending',
      ascending: 'descending',
      descending: 'natural'
    };

    let curDirection = "natural";
    if (this._sortColumn == col.id)
      curDirection = col.getAttribute("sortDirection");

    if (this._sortColumn)
      document.getElementById(this._sortColumn).removeAttribute("sortDirection");

    curDirection = cycle[curDirection];
    if (curDirection == "natural")
    {
      this._sortColumn = null;
      this._sortDirection = null;
    }
    else
    {
      this._sortColumn = col.id;
      this._sortDirection = curDirection;
      col.setAttribute("sortDirection", this._sortDirection);
    }
    this.refilter();
  },
  isSorted: function()
  {
    return (this._sortColumn != null);
  },

  isContainer: function() {return false},
  isContainerOpen: function() {return false},
  isContainerEmpty: function() {return false},
  getLevel: function() {return 0},
  getParentIndex: function() {return -1},
  hasNextSibling: function() {return false},
  toggleOpenState: function() {},
  canDrop: function() {return false},
  drop: function() {},
  getCellValue: function() {return null},
  getProgressMode: function() {return null},
  getImageSrc: function() {return null},
  isSeparator: function() {return false},
  isEditable: function() {return false},
  cycleCell: function() {},
  performAction: function() {},
  performActionOnRow: function() {},
  performActionOnCell: function() {},
  selectionChanged: function() {},

  //
  // Custom methods
  //

  get ignoreEarlyReturns()
  {
    return this._ignoreEarlyReturns;
  },
  set ignoreEarlyReturns(value)
  {
    this._ignoreEarlyReturns = value;
    this.refilter();
  },

  get filterString()
  {
    return this._filterString;
  },
  set filterString(value)
  {
    this._filterString = value.toLowerCase();
    this.refilter();
  },

  filter: function(entry)
  {
    if (this._ignoreEarlyReturns && entry.earlyReturn)
      return false;

    if (this._filterString)
    {
      let foundMatch = false;
      for each (let label in entry.cols)
        if (label.toLowerCase().indexOf(this._filterString) >= 0)
          foundMatch = true;

      if (!foundMatch)
        return false;
    }
    return true;
  },

  compare: function(entry1, entry2)
  {
    if (!this.isSorted())
      return 0;

    let value1 = entry1.cols[this._sortColumn];
    let value2 = entry2.cols[this._sortColumn];
    if (this._sortColumn == "time")
    {
      value1 = parseInt(value1) || 0;
      value2 = parseInt(value2) || 0;
    }
    else
    {
      if (value1)
        value1 = value1.toLowerCase();
      else
        value1 = "";
      if (value2)
        value2 = value2.toLowerCase();
      else
        value2 = "";
    }

    let result = 0;
    if (value1 < value2)
      result = -1;
    else if (value1 > value2)
      result = 1;

    if (this._sortDirection == "descending")
      result = -result;

    return result;
  },

  add: function(entry)
  {
    this.currentItems.push(entry);
    if (this.filter(entry))
    {
      let pos = this.displayedItems.length;
      if (this.isSorted())
        for (pos = 0; pos < this.displayedItems.length && this.compare(this.displayedItems[pos], entry) <= 0; pos++);

      this.displayedItems.splice(pos, 0, entry);
      this.boxObject.rowCountChanged(pos, 1);
      if (pos == this.displayedItems.length - 1 && this.boxObject.getLastVisibleRow() == pos - 1)
        this.boxObject.ensureRowIsVisible(pos);
      this.notifyObservers("add", entry);
    }
  },

  clear: function()
  {
    let oldRows = this.rowCount;

    this.currentItems = [];
    this.displayedItems = [];
    this.boxObject.rowCountChanged(0, -oldRows);
    this.notifyObservers("refresh");
  },

  refilter: function()
  {
    let oldRows = this.rowCount;
    this.displayedItems = this.currentItems.filter(this.filter, this);
    if (this.isSorted())
    {
      let me = this;
      this.displayedItems.sort(function(){
        return me.compare.apply(me, arguments);
      });
    }
    let newRows = this.rowCount;

    if (oldRows != newRows)
      this.boxObject.rowCountChanged(oldRows < newRows ? oldRows : newRows, newRows - oldRows);
    this.boxObject.invalidate();
    this.notifyObservers("refresh");
  },

  getEntryAt: function(x, y)
  {
    let row = this.boxObject.getRowAt(x, y);
    if (row < 0 || row >= this.displayedItems.length)
      return null;

    return this.displayedItems[row];
  },

  getCurrentEntry: function()
  {
    let row = this.selection.currentIndex;
    if (row < 0 || row >= this.displayedItems.length)
      return null;

    return this.displayedItems[row];
  },

  addObserver: function(observer)
  {
    this.observers.push(observer);
  },
  removeObserver: function(observer)
  {
    for (let i = 0; i < this.observers.length; i++)
      if (this.observers[i] == observer)
        this.observers.splice(i--, 1);
  },
  notifyObservers: function(operation, entry)
  {
    for each (let observer in this.observers)
      observer(this, operation, entry);
  }
};
