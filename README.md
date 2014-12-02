ruget
=====
Command line tool to interact with a remote [ruTorrent](http://forums.rutorrent.org) server.


Installation
------------

Grab from NPM:

	sudo npm install -g ruget

OR

	git clone https://github.com/hash-bang/ruget.git
	npm install
	sudo ln -s $PWD/ruget /usr/bin/ruget

Then copy the [.ruget.json](docs/ruget.json.sample) file into your home directory.


Example uses
============

	# Get help
	ruget --help

	# List all files on server
	ruget -l

	# List only files in the 'Seeding' tag matching 'Foo*'
	ruget -l -t seeding Foo*

	# Download files in the 'Seeding' tag matching 'Foo*'
	ruget -t seeding Foo*

	# Download all completed files
	ruget -c

	# List all files with a ratio of at least 10
	ruget -r 10

	# Download files matching 'Foo*' in size order
	rtget -s size Foo*
