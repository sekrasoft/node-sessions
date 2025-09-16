var mysql = require("mysql");

function MySqlStore(opts) {
	this.opts = opts || {};
	if (!this.opts.hasOwnProperty("table")) {
		this.opts.table = "sessions";
	}
	if (!this.opts.hasOwnProperty("connectionLimit")) {
		this.opts.connectionLimit = 2;
	}
	this.db = mysql.createPool(this.opts);
}
MySqlStore.prototype.add = function (uid) {
	var meta = null, data = {}, cb = null, success = false;

	for (var i = 1; i < arguments.length; i++) {
		switch (typeof arguments[i]) {
			case "function":
				cb = arguments[i];
				break;
			case "object":
				if (meta === null) {
					meta = arguments[i];
				} else {
					data = arguments[i];
				}
				break;
		}
	}

	if (meta === null) {
		meta = {};
	}

	this.db.query("INSERT INTO `" + this.opts.table + "` (uid, meta, data) VALUES (?, ?, ?)",
	              [ uid, JSON.stringify(meta), JSON.stringify(data) ], function (err) {
		if (err) {
			return cb(err);
		}

		return cb(null, meta, data);
	});

	return this;
};
MySqlStore.prototype.uids = function (cb) {
	this.db.query("SELECT uid FROM `" + this.opts.table + "`", function (err, items) {
		if (err) {
			return cb(err);
		}

		var keys = [];
		for (var i = 0; i < items.length; i++) {
			keys.push(items[i].uid);
		}

		return cb(null, keys);
	});

	return this;
};
MySqlStore.prototype._load = function (cb) {
	this.db.query("SELECT * FROM `" + this.opts.table + "`", function (err, items) {
		if (err) {
			return cb(err);
		}

		var entries = [], meta, data;
		for (var i = 0; i < items.length; i++) {
			try {
				meta = JSON.parse(items[i].meta);
			} catch (e) {
				meta = {};
			}
			try {
				data = JSON.parse(items[i].data);
			} catch (e) {
				data = {};
			}
			entries.push({
				uid: items[i].uid,
				meta: meta,
				data: data
			});
		}

		return cb(null, entries);
	});

	return this;
};
MySqlStore.prototype._save = function (updated, removed, cb) {
	var t = this.opts.table;

	if ((!updated || !updated.length) && (!removed || !removed.length)) {
		return cb(null);
	}

	this.db.getConnection(function (err, conn) {
		if (err) return cb(err);

		function onerror(err) {
			conn.rollback(function () {
				conn.release();
				cb(err);
			});
		}

		function remove (removed, cb) {
			if (!removed || !removed.length) return cb(null);
			conn.query("DELETE FROM `" + t + "` WHERE uid IN (?)", [removed], cb);
		}

		function update (updated, cb) {
			if (!updated || !updated.length) return cb(null);
			var params = [], query = "INSERT INTO `" + t + "` (uid, meta, data) VALUES", sep = " ";
			updated.forEach(function (e) {
				params.push(e.uid, JSON.stringify(e.meta), JSON.stringify(e.data));
				query += sep + "(?, ?, ?)";
				sep = ", ";
			});
			query += " ON DUPLICATE KEY UPDATE meta=VALUES(meta), data=VALUES(data)";
			conn.query(query, params, cb);
		}

		conn.beginTransaction(function (err) {
			if (err) {
				conn.release();
				return cb(err);
			}

			remove(removed, function (err) {
				if (err) return onerror(err);
				update(updated, function (err) {
					if (err) return onerror(err);
					conn.commit(function (err) {
						if (err) return onerror(err);
						conn.release();
						cb();
					});
				});
			});
		});
	});
	return this;
};
MySqlStore.prototype.set = function (uid, meta, data, cb) {
	var db = this.db, t = this.opts.table;

	db.query("SELECT * FROM `" + t + "` WHERE uid=?", [ uid ], function (err, sessions) {
		if (err || !sessions.length) {
			typeof cb == "function" && cb(new Error("uid not found"));
			return;
		}

		try {
			sessions[0].meta = JSON.parse(sessions[0].meta);
		} catch (e) {
			sessions[0].meta = {};
		}
		try {
			sessions[0].data = JSON.parse(sessions[0].data);
		} catch (e) {
			sessions[0].data = {};
		}

		for (k in meta) {
			sessions[0].meta[k] = meta[k];
		}
		for (k in data) {
			sessions[0].data[k] = data[k];
		}

		db.query("UPDATE `" + t + "` SET data = ?, meta = ? WHERE uid = ?",
			[ JSON.stringify(sessions[0].data), JSON.stringify(sessions[0].meta), uid ], function (err) {
			if (err) {
				typeof cb == "function" && cb(new Error("Could not save new meta/data"));
				return;
			}

			typeof cb == "function" && cb(null);
		});
	});

	return this;
};
MySqlStore.prototype.get = function (uid) {
	var key = null, cb = null;

	for (var i = 1; i < arguments.length; i++) {
		switch (typeof arguments[i]) {
			case "string":
				key = arguments[i];
				break;
			case "function":
				cb = arguments[i];
				break;
		}
	}

	if (cb === null) {
		throw new Error("missing callback");
	}

	this.db.query("SELECT * FROM `" + this.opts.table + "` WHERE uid = ?", [ uid ], function (err, sessions) {
		if (err || !sessions.length) {
			return cb(new Error("uid not found"));
		}

		try {
			sessions[0].meta = JSON.parse(sessions[0].meta);
		} catch (e) {
			sessions[0].meta = {};
		}
		try {
			sessions[0].data = JSON.parse(sessions[0].data);
		} catch (e) {
			sessions[0].data = {};
		}

		if (key === null) {
			return cb(null, sessions[0].meta, sessions[0].data);
		}

		return cb(null, sessions[0].data.hasOwnProperty(key) ? sessions[0].data[key] : null);
	});

	return this;
};
MySqlStore.prototype.remove = function () {
	var items = Array.prototype.slice.apply(arguments),
	    uid = items.shift(), cb = items.pop(),
	    db = this.db, t = this.opts.table;

	if (items.length == 0) {
		db.query("DELETE FROM `" + t + "` WHERE uid = ?", [ uid ], function () {
			typeof cb == "function" && cb(null);
		});
		return this;
	}

	db.query("SELECT * FROM `" + t + "` WHERE uid = ?", [ uid ], function (err, sessions) {
		if (err || !sessions.length) {
			typeof cb == "function" && cb(new Error("uid not found"));

			return this;
		}

		try {
			sessions[0].data = JSON.parse(sessions[0].data);
		} catch (e) {
			sessions[0].data = {};
		}

		for (k in items) {
			delete sessions[0].data[items[k]];
		}

		db.query("UPDATE `" + t + "` SET data = ? WHERE uid = ?",
			[ JSON.stringify(sessions[0].data), uid ], function (err) {
			if (err) {
				typeof cb == "function" && cb(new Error("Could not remove data"));
				return;
			}

			typeof cb == "function" && cb(null);
		});
	});

	return this;
};

module.exports = MySqlStore;