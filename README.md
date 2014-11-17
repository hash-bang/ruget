ruget
=====
Command line tool to interact with a remote [ruTorrent](http://forums.rutorrent.org) server.


Installation
------------

	git clone https://github.com/hash-bang/ruget.git
	npm install

Copy the [.ruget.json](docs/ruget.json.sample) file into your home directory.


Example uses
============

	# List all files on server
	ruget -l

	# List only files in the 'Seeding' tag matching 'Foo*'
	ruget -l -t seeding Foo*

	# Download files in the 'Seeding' tag matching 'Foo*'
	ruget -t seeding Foo*
