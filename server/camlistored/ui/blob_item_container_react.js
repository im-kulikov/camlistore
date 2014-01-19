/*
Copyright 2014 The Camlistore Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

goog.provide('cam.BlobItemContainerReact');

goog.require('goog.array');
goog.require('goog.dom');
goog.require('goog.events.EventHandler');
goog.require('goog.object');
goog.require('goog.math.Coordinate');
goog.require('goog.math.Size');
goog.require('goog.style');

goog.require('cam.BlobItemReact');
goog.require('cam.BlobItemReactData');
goog.require('cam.reactUtil');
goog.require('cam.SearchSession');

cam.BlobItemContainerReact = React.createClass({
	displayName: 'BlobItemContainerReact',

	// Margin between items in the layout.
	BLOB_ITEM_MARGIN_: 7,

	// If the last row uses at least this much of the available width before adjustments, we'll call it "close enough" and adjust things so that it fills the entire row. Less than this, and we'll leave the last row unaligned.
	LAST_ROW_CLOSE_ENOUGH_TO_FULL_: 0.85,

	// Distance from the bottom of the page at which we will trigger loading more data.
	INFINITE_SCROLL_THRESHOLD_PX_: 100,

	propTypes: {
		detailURL: React.PropTypes.func.isRequired,  // string->string (blobref->complete detail URL)
		history: cam.reactUtil.quacksLike({replaceState:React.PropTypes.func.isRequired}).isRequired,
		onSelectionChange: React.PropTypes.func,
		searchSession: cam.reactUtil.quacksLike({getCurrentResults:React.PropTypes.func.isRequired, addEventListener:React.PropTypes.func.isRequired, loadMoreResults:React.PropTypes.func.isRequired}),
		selection: React.PropTypes.object.isRequired,
		style: React.PropTypes.object,
		thumbnailSize: React.PropTypes.number.isRequired,
		thumbnailVersion: React.PropTypes.number.isRequired,
	},

	getDefaultProps: function() {
		return {
			style: {},
		};
	},

	componentWillMount: function() {
		this.eh_ = new goog.events.EventHandler(this);
		this.lastCheckedIndex_ = -1;
		this.scrollbarWidth_ = goog.style.getScrollbarWidth();
		this.layoutHeight_ = 0;
	},

	componentDidMount: function() {
		this.eh_.listen(this.props.searchSession, cam.SearchSession.SEARCH_SESSION_CHANGED, this.handleSearchSessionChanged_);
		this.eh_.listen(this.getDOMNode(), 'scroll', this.handleScroll_);
		if (this.props.history.state && this.props.history.state.scroll) {
			var el = this.getDOMNode();
			var oldScroll = el.scrollTop;
			el.scrollTop = this.props.history.state.scroll;
			this.props.history.replaceState({scroll:0});
			if (oldScroll != el.scrollTop) {
				return;
			}
		}

		// If we weren't able to scroll to a remembered position, call handleScroll once anyway to scroll to zero. This will cause us to load our initial data.
		this.handleScroll_();
	},

	componentWillReceiveProps: function(nextProps) {
		if (nextProps.searchSession != this.props.searchSession) {
			this.eh_.unlisten(this.props.searchSession, cam.SearchSession.SEARCH_SESSION_CHANGED, this.handleSearchSessionChanged_);
			this.eh_.listen(nextProps.searchSession, cam.SearchSession.SEARCH_SESSION_CHANGED, this.handleSearchSessionChanged_);
		}
	},

	componentWillUnmount: function() {
		this.eh_.dispose();
	},

	render: function() {
		var results = this.props.searchSession.getCurrentResults();
		var children = [];
		var data = goog.array.map(results.blobs, function(blob) {
			return new cam.BlobItemReactData(blob.blob, results.description.meta);
		});

		var currentTop = this.BLOB_ITEM_MARGIN_;
		var currentWidth = this.BLOB_ITEM_MARGIN_;
		var rowStart = 0;
		var lastItem = results.blobs.length - 1;

		for (var i = rowStart; i <= lastItem; i++) {
			var item = data[i];
			var availWidth = this.props.style.width - this.scrollbarWidth_;
			var nextWidth = currentWidth + this.props.thumbnailSize * item.aspect + this.BLOB_ITEM_MARGIN_;
			if (i != lastItem && nextWidth < availWidth) {
				currentWidth = nextWidth;
				continue;
			}

			// Decide how many items are going to be in this row. We choose the number that will result in the smallest adjustment to the image sizes having to be done.
			var rowEnd, rowWidth;
			if (i == lastItem) {
				rowEnd = lastItem;
				rowWidth = nextWidth;
				if (nextWidth / availWidth < this.LAST_ROW_CLOSE_ENOUGH_TO_FULL_) {
					availWidth = nextWidth;
				}
			} else if (availWidth - currentWidth <= nextWidth - availWidth) {
				rowEnd = i - 1;
				rowWidth = currentWidth;
			} else {
				rowEnd = i;
				rowWidth = nextWidth;
			}

			currentTop += this.renderChildren_(data, children, rowStart, rowEnd, availWidth, rowWidth, currentTop) + this.BLOB_ITEM_MARGIN_;

			currentWidth = this.BLOB_ITEM_MARGIN_;
			rowStart = rowEnd + 1;
			i = rowEnd;
		}

		// If we haven't filled the window with results, add some more.
		this.layoutHeight_ = currentTop;

		return React.DOM.div({className:'cam-blobitemcontainer', style:this.props.style, onMouseDown:this.handleMouseDown_}, children);
	},

	renderChildren_: function(data, children, startIndex, endIndex, availWidth, usedWidth, top) {
		var currentLeft = 0;
		var rowHeight = Number.POSITIVE_INFINITY;

		var numItems = endIndex - startIndex + 1;
		var availThumbWidth = availWidth - (this.BLOB_ITEM_MARGIN_ * (numItems + 1));
		var usedThumbWidth = usedWidth - (this.BLOB_ITEM_MARGIN_ * (numItems + 1));
		var rowProps = [];

		for (var i = startIndex; i <= endIndex; i++) {
			// We figure out the amount to adjust each item in this slightly non-intuitive way so that the adjustment is split up as fairly as possible. Figuring out a ratio up front and applying it to all items uniformly can end up with a large amount left over because of rounding.
			var item = data[i];
			var numItemsLeft = (endIndex + 1) - i;
			var delta = Math.round((availThumbWidth - usedThumbWidth) / numItemsLeft);
			var originalWidth = this.props.thumbnailSize * item.aspect;
			var width = originalWidth + delta;
			var ratio = width / originalWidth;
			var height = Math.round(this.props.thumbnailSize * ratio);

			rowProps.push({
				key: item.blobref,
				blobref: item.blobref,
				checked: Boolean(this.props.selection[item.blobref]),
				href: this.props.detailURL(item).toString(),
				data: item,
				onCheckClick: this.handleCheckClick_,
				position: new goog.math.Coordinate(currentLeft + this.BLOB_ITEM_MARGIN_, top),
				size: new goog.math.Size(width, height),
				thumbnailVersion: this.props.thumbnailVersion,
			});

			currentLeft += width + this.BLOB_ITEM_MARGIN_;
			usedThumbWidth += delta;
			rowHeight = Math.min(rowHeight, height);
		}

		for (var i = 0; i < rowProps.length; i++) {
			rowProps[i].size.height = rowHeight;
			children.push(cam.BlobItemReact(rowProps[i]));
		}

		return rowHeight;
	},

	handleSearchSessionChanged_: function() {
		this.forceUpdate();
	},

	handleCheckClick_: function(blobref, e) {
		var blobs = this.props.searchSession.getCurrentResults().blobs;
		var index = goog.array.findIndex(blobs, function(b) { return b.blob == blobref });
		var newSelection = cam.object.extend(this.props.selection, {});

		if (e.shiftKey && this.lastCheckedIndex_ > -1) {
			var low = Math.min(this.lastCheckedIndex_, index);
			var high = Math.max(this.lastCheckedIndex_, index);
			for (var i = low; i <= high; i++) {
				newSelection[blobs[i].blob] = true;
			}
		} else {
			if (newSelection[blobref]) {
				delete newSelection[blobref];
			} else {
				newSelection[blobref] = true;
			}
		}

		this.lastCheckedIndex_ = index;
		this.forceUpdate();

		if (this.props.onSelectionChange) {
			this.props.onSelectionChange(newSelection);
		}
	},

	handleMouseDown_: function(e) {
		// Prevent the default selection behavior.
		if (e.shiftKey) {
			e.preventDefault();
		}
	},

	handleScroll_: function() {
		var scroll = this.getDOMNode().scrollTop;
		this.props.history.replaceState({scroll:scroll});

		if ((this.layoutHeight_ - scroll - this.props.style.height) > this.INFINITE_SCROLL_THRESHOLD_PX_) {
			return;
		}

		this.props.searchSession.loadMoreResults();
	},
});
