var _ = require('lodash');
var colors = require('colors');
var humanSize = require('human-size');
var request = require('superagent');
var program = require('commander');
var q = require('q');
var settings = require('./settings.json'); // FIXME: This needs to be replaced with an INI file or something
var table = require('easy-table');

program
	.version(require('./package.json').version)
	.usage('[-l] [-t tags...]')
	.option('-d, --dryrun', 'Dont actually run any commands, just output what would have run')
	.option('-l, --list', 'List all files on server (use -t to filter, -s to sort)')
	.option('-f, --fast', 'Try to download files as quickly as possible')
	.option('-t, --tag [tags...]', 'Filter by tag', function(item, value) { value.push(item); return value; }, []) // Coherce into array of tags to filter by
	.option('-s, --sort [fields...]', 'Sort by field', function(item, value) { value.push(item); return value; }, [])
	.parse(process.argv);

// Populate defaults {{{
if (program.sort.length == 0)
	program.sort = settings.sortOrder || ['name'];
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
				.values()
				.filter(function(item) {
					return _.isArray(item) && item.length > 15;
				})
				.map(function(item) {
					return {
						name: item[4],
						size: item[5],
						complete: 100, // FIXME: This is wrong
						tag: item[14],
						added: new Date(item[21] * 1000),
						path: item[25],
					}
				});

			if (options.tag && options.tag.length > 0) {
				var tagSearch = options.tag.map(function(item) { // Remove case from all tags and strip non ASCCI characters
					return item.toLowerCase().replace(/[^a-z0-9]+/, '');
				});
				items = items.filter(function(item) {
					return _.contains(tagSearch, item.tag.toLowerCase().replace(/[^a-z0-9]+/, ''));
				});
			}

			if (options.sort && options.sort.length > 0)
				items = items.sortBy(options.sort);

			items = items.valueOf();
			console.log('REMAINING', items.length);
			if (items.length > 0) {
				defer.resolve(items);
			} else {
				defer.reject();
			}
		});
	return defer.promise;
}


if (program.list) {
 // List mode {{{
	fetchList(program)
		.then(function(items) {
			var t = new table;
			items.forEach(function(item) {
				t.cell('Name', item.name);
				t.cell('%', item.complete);
				t.cell('Size', humanSize(item.size));
				t.newRow();
			});
			console.log(t.toString());
		})
		.fail(function() {
			console.log('No matching items found');
		});
// }}}
} else { // Grab mode
	fetchList(program)
		.then(function(items) {
			items.forEach(function(item, index) {
				console.log('Downloading'.bold, item.name.blue, ('[' + (index+1) + '/' + items.length + ']').cyan);
				var command = program.fast ? settings.commands.downloadFast : settings.commands.download;
				command = command.replace('<path>', item.path.replace("'", "\\'"));
				if (program.dryrun) {
					console.log('EXEC'.bold.red, command);
				}
			});
		})
		.fail(function() {
			console.log('No matching items to download');
		});
}
