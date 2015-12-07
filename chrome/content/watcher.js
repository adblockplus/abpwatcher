/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");

function abprequire(module)
{
  let result = {};
  result.wrappedJSObject = result;
  Services.obs.notifyObservers(result, "adblockplus-require", module);
  return result.exports;
}

let {Policy} = abprequire("contentPolicy");
let {Filter} = abprequire("filterClasses");

let origShouldAllow = Policy.shouldAllow;
if (!origShouldAllow)
  window.close();

let processingQueue = [];
let notifier = null;

// Randomize URI to work around bug 719376
let stringBundle = Services.strings.createBundle("chrome://abpwatcher/locale/global.properties?" + Math.random());

let clipboardHelper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);

function init()
{
  let list = document.getElementById("list");
  list.view = treeView;
  list.focus();

  treeView.addObserver(updateProcessingTime);
  updateProcessingTime(treeView, "refresh");

  // Make sure the tree view has correct filters
  document.getElementById("filterText").doCommand();

  Policy.shouldAllow = replacementShouldAllow;
  setInterval(processQueue, 200);
}

function E(id)
{
  return document.getElementById(id);
}

function replacementShouldAllow({contentType, location, frames, isPrivate})
{
  let startTime = Date.now();
  let currentData = {
    type: contentType,
    location: location,
    frames: frames,
    isPrivate: isPrivate
  };
  let ret;

  try
  {
    ret = origShouldAllow.apply(this, arguments);
    return ret;
  }
  finally
  {
    if (startTime !== null)
    {
      currentData.processingTime = (Date.now() - startTime);
      currentData.result = ret;
      currentData.filters = ret.hits.filter(h => h.filter).map(h => h.filter);

      processingQueue.push(currentData);
      currentData = null;
    }
  }
}

function destroy()
{
  if (origShouldAllow)
    Policy.shouldAllow = origShouldAllow;
}

function processQueue()
{
  if (!processingQueue.length)
    return;

  function stringify(value)
  {
    if (typeof value == "undefined" || value == null)
      return "";
    else
      return String(value);
  }

  for each (let entry in processingQueue)
  {
    entry.cols = {
      address: stringify(entry.location),
      type: stringify(entry.type),
      result: stringBundle.GetStringFromName(entry.result && entry.result.allow ? "decision.allow" : "decision.block"),
      origin: stringify(entry.frames && entry.frames[0] && entry.frames[0].location),
      filter: stringify(entry.filters && entry.filters.join(", ")),
      time: stringify(entry.processingTime)
    };
    treeView.add(entry);
  }

  processingQueue = [];
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
      let data = entry.cols[col];
      if (col == "origin")
        data = entry.frames.map(f => f.location).join("\n");
      setMultilineContent(value, data);
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

function setMultilineContent(box, text)
{
  let lines = text.split(/\n+/);
  for (let line of lines)
  {
    let description = document.createElement("description");
    description.textContent = line.replace(/\S{80}(?=\S)/g, "$& ");
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
    for each (let col in ["address", "type", "result", "origin", "filter", "time"])
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

  generateProperties: function(list, properties)
  {
    if (properties)
    {
      // Gecko 21 and below: we have an nsISupportsArray parameter, add atoms
      // to that.
      for (let i = 0; i < list.length; i++)
        if (list[i] in this.atoms)
          properties.AppendElement(this.atoms[list[i]]);
      return null;
    }
    else
    {
      // Gecko 22+: no parameter, just return a string
      return list.join(" ");
    }
  },

  getColumnProperties: function(col, properties)
  {
    return this.generateProperties(["col-" + col.id], properties);
  },

  getRowProperties: function(row, properties)
  {
    if (row < 0 || row >= this.displayedItems.length)
      return "";

    let entry = this.displayedItems[row];
    return this.generateProperties([
        "selected-" + this.selection.isSelected(row),
        "blocked-" + !(entry.result && entry.result.allow)
      ], properties);
  },

  getCellProperties: function(row, col, properties)
  {
    return this.getRowProperties(row, properties) + " " + this.getColumnProperties(col, properties);
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
