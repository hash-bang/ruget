#!/usr/bin/env node

var _ = require('lodash');
var async = require('async');
var colors = require('colors');
var fs = require('fs');
var humanSize = require('human-size');
var minimatch = require('minimatch');
var program = require('commander');
var spawn = require('child_process').spawn;
var spawnArgs = require('spawn-args');
var request = require('superagent');
var q = require('q');
var table = require('easy-table');

program
	.version(require('./package.json').version)
	.usage('[-l] [-t tags...]')
	.option('-c, --complete', 'Filter by completed files')
	.option('-d, --dryrun', 'Dont actually run any commands, just output what would have run')
	.option('-l, --list', 'List all files on server (use -t or -c to filter, -s to sort)')
	.option('-f, --fast', 'Try to download files as quickly as possible')
	.option('-m, --move [tag]', 'Move an item to the given tag (if fetching this occurs after successful download)')
	.option('-r, --ratio [value]', 'Filter by a minimum ratio')
	.option('-s, --sort [fields...]', 'Sort by field', function(item, value) { value.push(item); return value; }, [])
	.option('-t, --tag [tags...]', 'Filter by tag (or "none" for items with no tag)', function(item, value) { value.push(item); return value; }, []) // Coherce into array of tags to filter by
	.option('-u, --upload', 'Upload the specified torrent files')
	.option('-v, --verbose', 'Be verbose')
	.parse(process.argv);

// Settings {{{
// Sanity checks {{{
if (!process.env || !process.env.HOME) {
	console.log('Environment variable HOME not found');
}
// }}}
// Load settings {{{
var settingsPath = process.env.HOME + '/.ruget.json';
try {
	var data = fs.readFileSync(settingsPath);
	var settings = JSON.parse(data);
} catch (e) {
	console.log('No', settingsPath.cyan, 'settings file found or the file is invalid JSON');
	process.exit(1);
}

if (!settings.url) {
	console.log('No', 'url'.cyan, 'specified in the settings file');
	process.exit(1);
}
if (!settings.commands || !settings.commands.download) {
	console.log('No', 'commands.download'.cyan, 'download binary specified in the settings file');
	process.exit(1);
}
if (!settings.commands || !settings.commands.downloadFast) {
	console.log('No', 'commands.downloadFast'.cyan, 'download binary specified in the settings file');
	process.exit(1);
}
// }}}
// Populate defaults {{{
if (program.sort.length == 0)
	program.sort = settings.sortOrder || ['name'];
// }}}
// Init settings {{{
if (settings.acceptAllCerts) {
	// If enabled we need to force TLS to accept even invalid certs
	// FIXME: There is no sensible way to do this with Superagent yet as per https://github.com/visionmedia/superagent/issues/188
	// So the only way we can do this is overriding the TLS env variable
	// @date 2015-02-10
	// @author Matt Carter <m@ttcarter.com>
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
}
// }}}
// }}}

/**
* Query the server for a list of active items
* @param object options Options object to filter by
* @return promise A promise object - resolve() is fired if at least one items matches, reject otherwise
*/
function fetchList(options) {
	var defer = q.defer();
	request
		.post(settings.url)
		.set('Content-Type', 'application/json')
		.set('Accept', 'application/json, text/javascript, */*; q=0.01')
		.send(
			'mode=list&' +
			'cmd[]=d.get_throttle_name=&' +
			'cmd[]=d.get_custom=chk-state&' +
			'cmd[]=d.get_custom=chk-time&' +
			'cmd[]=d.get_custom=sch_ignore&' +
			'cmd[]=cat="$t.multicall=d.get_hash=,t.get_scrape_complete=,cat=#"&' +
			'cmd[]=cat="$t.multicall=d.get_hash=,t.get_scrape_incomplete=,cat=#"&' +
			'cmd[]=cat=$d.views=&' +
			'cmd[]=d.get_custom=seedingtime&' +
			'cmd[]=d.get_custom=addtime'
		)
		.end(function(res) {
			var items = _(res.body.t)
				.map(function(item, hash) {
					item.push(hash);
					return item;
				})
				.values() // Convert from object -> collection
				.filter(function(item) { // Scrap invalid items
					return _.isArray(item) && item.length > 15;
				})
				.map(function(item) { // Rewrite array into a logical structure
					return {
						hash: item[34],
						name: item[4],
						size: item[5],
						complete: Math.round(item[6] / item[7] * 1000) / 10,
						ratio: item[10] / 1000,
						tag: item[14],
						added: new Date(item[21] * 1000),
						path: item[25],
					}
				});

			if (options.args && options.args.length > 0) { // Filter by filename by glob?
				items = items.filter(function(item) {
					return _.some(options.args, function(arg) {
						return minimatch(item.name, arg, {
							nocase: true,
						});
					});
				});
			}

			if (options.complete) { // Filter by completed
				items = items.filter(function(item) {
					return item.complete >= 100;
				});
			}

			if (options.ratio) { // Filter by minimum ratio
				items = items.filter(function(item) {
					return item.ratio >= options.ratio;
				});
			}

			if (options.tag && options.tag.length > 0) { // Filter by an array of tags
				var tagSearch = options.tag.map(function(item) { // Remove case from all tags and strip non ASCCI characters
					return item.toLowerCase().replace(/[^a-z0-9]+/, '');
				});
				if (_.contains(tagSearch, 'none')) { // Special case to search for items without a tag
					items = items.filter(function(item) {
						return !item.tag;
					});
				} else {
					items = items.filter(function(item) {
						return _.contains(tagSearch, item.tag.toLowerCase().replace(/[^a-z0-9]+/, ''));
					});
				}
			}

			if (options.sort && options.sort.length > 0) // Apply sorting
				items = items.sortBy(options.sort);

			items = items.valueOf(); // Convert into JS array and return
			if (items.length > 0) {
				defer.resolve(items);
			} else {
				defer.reject();
			}
		});
	return defer.promise;
}

/**
* Move a given item into a tag
* @param object program The commander program options object
* @param object item The item to move
* @param string tag The new tag the item should have ('none' is a special case to remove the tag)
* @param function callback(res) The callback to execute on completion
*/
function moveItem(program, item, tag, callback) {
	if (program.dryrun) {
		console.log('Would change tag to', tag.cyan);
	} else {
		request
			.post(settings.url)
			.set('Content-Type', 'application/x-www-form-urlencoded')
			.set('Accept', 'application/json, text/javascript, */*; q=0.01')
			.send(
				'mode=setlabel&' +
				'hash=' + item.hash + '&' +
				'v=' + (tag == 'none' ? '' : tag) + '&' +
				's=label'
			)
			.end(function(res) {
				if (_.isFunction(callback))
					callback(res);
			});
	}
}

if (program.args && _.some(program.args, function(item) { // There are command line args specified
	try {
		var stats = fs.statSync(item);
	} catch(e) {
		return false;
	}
	if (program.verbose)
		console.log('At least one command parameter is a file - switching to upload mode');
	return stats;
})) // At least one file is local and on disk - switch to 'upload' mode
	program.upload = true;

if (program.list) {
 // List mode {{{
	fetchList(program)
		.then(function(items) {
			var t = new table;
			items.forEach(function(item) {
				t.cell('Name', item.name);
				t.cell('%', item.complete);
				t.cell('Ratio', item.ratio);
				t.cell('Size', humanSize(item.size));
				t.newRow();
			});
			console.log(t.toString());
		})
		.fail(function() {
			console.log('No matching items found');
		});
// }}}
} else if (program.upload) {
// Upload mode {{{
	var args, argBin;
	if (_.isString(settings.commands.upload)) {
		args = spawnArgs(settings.commands.upload);
		argBin = args.shift();
	} else {
		args = settings.commands.upload;
		argBin = args.shift();
	}

	var myArgs = args.map(function(arg) {
		return arg
			.replace('<paths>', program.args.join(' '))
			.replace('<dir>', __dirname);
	});

	if (program.dryrun || program.verbose) {
		console.log('EXEC'.bold.red, argBin, myArgs);
	}

	if (!program.dryrun)
		spawn(argBin, myArgs, {stdio: 'inherit'})
			.on('close', function(code) {
				if (code != 0)
					console.log('Uploader exited with code'.bold.red, code.toString().cyan);
			});
// }}}
} else { // Grab mode
	var command = program.fast ? settings.commands.downloadFast : settings.commands.download;
	var args, argBin;
	if (_.isString(command)) {
		args = spawnArgs(command);
		argBin = args.shift();
	} else {
		args = command;
		argBin = args.shift();
	}

	fetchList(program)
		.then(function(items) {
			var itemNo = 0;
			async.eachSeries(items, function(item, nextItem) {
				itemNo++;
				console.log('ruget'.black.bgWhite, 'Downloading'.bold, item.name.blue, ('[' + itemNo + '/' + items.length + ']').cyan);

				var myArgs = args.map(function(arg) {
					return arg
						.replace('<path>', item.path.replace("'", "\'"))
						.replace('<dir>', __dirname);
				});

				if (program.dryrun || program.verbose) {
					console.log('EXEC'.bold.red, argBin, myArgs);
				}

				if (!program.dryrun) {
					spawn(argBin, myArgs, {stdio: 'inherit'})
						.on('close', function(code) {
							if (code != 0) {
								console.log('Downloader exited with code'.bold.red, code.toString().cyan);
								nextItem(code);
							} else { // Successful download
								if (program.move) {
									console.log('ruget'.black.bgWhite, 'Moving to tag'.bold, program.move.cyan);
									moveItem(program, item, program.move, function(res) {
										console.log();
										nextItem();
									});
								} else {
									console.log();
									nextItem();
								}
							}
						});
				} else {
					console.log();
					nextItem();
				}
			});
		})
		.catch(function(e) {
			console.log('Caught', e);
		})
		.fail(function() {
			console.log('No matching items to download');
		});
}
