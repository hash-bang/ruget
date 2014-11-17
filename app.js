var _ = require('lodash');
var request = require('superagent');
var program = require('commander');
var q = require('q');
var settings = require('./settings.json'); // FIXME: This needs to be replaced with an INI file or something

program
	.version(require('./package.json').version)
	.usage('[-l] [-t tags...]')
	.option('-l, --list', 'List all files on server (use -t to filter)')
	.option('-t, --tag [tags]', 'Filter by tag', function(item, value) { value.push(item); return value; }, []) // Coherce into array of tags to filter by
	.parse(process.argv);


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
					// console.log(item);
					return {
						name: item[4],
						size: item[5],
						tag: item[14],
					}
				});

			if (options.tag) {
				var tagSearch = options.tag.map(function(item) { // Remove case from all tags and strip non ASCCI characters
					return item.toLowerCase().replace(/[^a-z0-9]+/, '');
				});
				items = items.filter(function(item) {
					return _.contains(tagSearch, item.tag.toLowerCase().replace(/[^a-z0-9]+/, ''));
				});
			}

			if (items) {
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
			items.forEach(function(item) {
				console.log(item);
			});
		})
		.fail(function() {
			console.log('No matching items found');
		});
// }}}
}
