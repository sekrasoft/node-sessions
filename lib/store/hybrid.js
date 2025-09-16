var MemoryStore = require('./memory');
var MySqlStore = require('./mysql');

function HybridStore(opts) {
	this.opts = opts || {};
	this.mem = new MemoryStore();
	this.db = new MySqlStore(opts);
	this.updated = null;

	if (!this.opts.hasOwnProperty("flushingInterval")) {
		this.opts.flushingInterval = 10000;
	}
console.log('SESSIONS verbose', this.opts.verbose);
	if (!this.opts.hasOwnProperty("verbose")) {
		this.opts.verbose = false;
	}

	var fi = this.opts.flushingInterval;
	console.assert(fi === (fi | 0) && fi > 0);

	var that = this;

	if (that.opts.verbose) console.log('SESSIONS | initializing...');

	var delayed = [];
	var methods = Object.keys(HybridStore.prototype).filter(function (n) {
		return 'function' === typeof HybridStore.prototype[n];
	});
	methods.forEach(function (name) {
		that[name] = function () {
			delayed.push({
				name: name,
				args: Array.prototype.slice.call(arguments)
			});
			if (that.opts.verbose) console.log('SESSIONS | DELAY', delayed[delayed.length - 1]);
		};
	});

	function nextIteration () {
		var store = that.mem.store;
		var updated = [], removed = [];

		for (var uid in that.updated) {
			if (!that.updated[uid]) {
				removed.push(uid);
				continue
			}

			if (!store.hasOwnProperty(uid)) continue;

			var entry = store[uid];
			updated.push({
				uid: uid,
				meta: entry.meta,
				data: entry.data
			});
		}
		if (that.opts.verbose) console.log('SESSIONS | flushing...', updated.length, removed.length);
		var oldupdated = that.updated;
		that.updated = Object.create(null);

		that.db._save(updated, removed, function (err) {
			if (err) {
				if (that.opts.verbose) console.log('SESSIONS | ERROR: cannot flush sessions', err.message || err);
				// restore for future use
				// that.updated := oldupdated + that.updated
				for (var uid in that.updated) {
					oldupdated[uid] = that.updated[uid];
				}
				that.updated = oldupdated;
			} else {
				if (that.opts.verbose) console.log('SESSIONS | flushed!');
			}

			setTimeout(nextIteration, that.opts.flushingInterval);
		});
	}

	this.db._load(function (err, data) {
		if (err) {
			if (that.opts.verbose) console.log('SESSIONS | ERROR: cannot load sessions', err.message || err);
		} else {
			data.forEach(function (e) {
				that.mem.add(e.uid, e.meta, e.data, function () {});
			});
			if (that.opts.verbose) console.log('SESSIONS | loaded', data.length);
		}
		that.updated = Object.create(null);

		methods.forEach(function (name) {
			delete that[name];
		});

		delayed.forEach(function (d) {
			if (that.opts.verbose) console.log('SESSIONS | CALL DELAYED', d);
			that[d.name].apply(that, d.args);
		});

		delayed = null;
		methods = null;

		setTimeout(nextIteration, that.opts.flushingInterval);
		if (that.opts.verbose) console.log('SESSIONS | initialized');
	});
}
HybridStore.prototype.add = function (uid) {
	this.updated[uid] = true;
	this.mem.add.apply(this.mem, arguments);
	return this;
};
HybridStore.prototype.uids = function (cb) {
	this.mem.uids.apply(this.mem, arguments);
	return this;
};
HybridStore.prototype.set = function (uid, meta, data, cb) {
	this.updated[uid] = true;
	this.mem.set.apply(this.mem, arguments);
	return this;
};
HybridStore.prototype.get = function (uid) {
	this.mem.get.apply(this.mem, arguments);
	return this;
};
HybridStore.prototype.remove = function () {
	this.updated[uid] = false;
	this.mem.remove.apply(this.mem, arguments);
	return this;
};

module.exports = HybridStore;