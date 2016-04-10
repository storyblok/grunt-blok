/*
 * grunt-blok
 * https://github.com/onefriendaday/grunt-blok
 *
 * Copyright (c) 2015 Alexander Feiglstorfer
 * Licensed under the BSD license.
 */
'use strict';

module.exports = function(grunt) {
    var blok = require('./lib/blok')(grunt);

    /*
     * blok noop.
     *
     * Use watch to monitor changes. To do an initial upload of all files on
     * your local copy, use the blok upload functionality.
     */
    grunt.registerTask('blok', function() {
        return true;
    });

    /**
     * Grunt watch event
     */
    grunt.event.on('watch', blok.watchHandler);
};