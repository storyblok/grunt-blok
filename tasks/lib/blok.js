var path = require('path'),
    util = require('util'),
    growl = require('growl'),
    async = require('async'),
    fs = require('fs'),
    isBinaryFile = require('isbinaryfile'),
    unirest = require('unirest');

module.exports = function(grunt) {
    var blok = {};
    blok._api = false;
    blok._apiOpts = {};
    blok._basePath = false;

    /*
     * Queued task worker.
     *
     * Receive task object and process it.
     *
     * @param {Object} task
     * @param {Function} callback
     * @see {@link https://github.com/caolan/async#queue}
     */
    blok._queueWorker = function(task, callback) {
        var config = grunt.config('blok');
        var rate_limit = config.options.rate_limit_delay ?
                config.options.rate_limit_delay :
                100 // default val

        function postUploadCallback() {
            task.done();
            // wait before concluding the task
            setTimeout(callback, rate_limit);
        }

        switch (task.action) {
            case 'upload':
                blok.upload(task.filepath, postUploadCallback);
                break;
            case 'remove':
                blok.remove(task.filepath, postUploadCallback);
                break;
            default:
                blok.notify('unrecognized worker task action: ' + task.action, true);
                break;
        }
    }

    blok.queue = async.queue(blok._queueWorker, 1);

    /*
     * Get the Theme ID.
     *
     * @return {integer}
     */
    blok._getThemeId = function() {
        var config = grunt.config('blok');
        return ('theme' in config.options) ? config.options.theme : false;
    };

    /*
     * Determine if path is being watched.
     *
     * @return {Boolean}
     */
    blok._isWatchedPath = function(filepath) {
        watchedFolders = grunt.config('watch').blok.files;

        return grunt.file.isMatch(watchedFolders,filepath);
    };

    /*
     * Helper for reporting messages to the user.
     *
     * @param {string} msg
     */
    blok.notify = function(msg, err) {
        var config = grunt.config('blok');

        msg = decodeURI(msg);
        err = err || false;

        if (config.options.disable_growl_notifications !== false) {
            growl(msg, { title: 'Grunt blok'});
        }

        if (!config.options.disable_grunt_log) {
            if (err) {
                grunt.log.error('[grunt-blok] - ' + msg);
            } else {
                grunt.log.ok('[grunt-blok] - ' + msg);
            }
        }
    };

    /*
     * Convert a file path on the local file system to an asset path in blok
     * as you may run grunt at a higher directory locally.
     *
     * The original path to a file may be something like shop/assets/site.css
     * whereas we require assets/site.css in the API. To customize the base
     * set blok.options.base config option.
     *
     * @param {string}
     * @return {string}
     */
    blok._makeAssetKey = function(filepath) {
        filepath = blok._makePathRelative(filepath);

        return encodeURI(filepath);
    };

    /**
     * Make a path relative to base path.
     *
     * @param {string} filepath
     * @return {string}
     */
    blok._makePathRelative = function(filepath) {
        var basePath = blok._getBasePath();

        filepath = path.relative(basePath, filepath);

        return filepath.replace(/\\/g, '/');
    };

    /*
     * Get the base path.
     *
     * @return {string}
     */
    blok._getBasePath = function() {
        if (!blok._basePath) {
            var config = grunt.config('blok'),
                base = ('base' in config.options) ? config.options.base : false;

            blok._basePath = (base.length > 0) ? path.resolve(base) : process.cwd();
        }

        return blok._basePath;
    };

    /*
     * Remove a given file path from blok.
     *
     * File should be the relative path on the local filesystem.
     *
     * @param {string} filepath
     * @param {Function} done
     */
    blok.remove = function(filepath, done) {
        /*if (!blok._isValidPath(filepath)) {
            return done();
        }*/

        var key = blok._makeAssetKey(filepath);

        blok.notify('File "' + key + '" being removed.');

        function onDestroy(err) {
            if (!err) {
                blok.notify('File "' + key + '" removed.');
            }

            done(err);
        }

        blok._apiCall('DELETE', {filepath: key}, onDestroy);
    };

    /*
     * Upload a given file path to blok
     *
     * Some requests may fail if those folders are ignored
     * @param {string} filepath
     * @param {Function} done
     */
    blok.upload = function(filepath, done) {
        /*if (!blok._isValidPath(filepath)) {
            return done();
        }*/

        var key = blok._makeAssetKey(filepath),
            isBinary = isBinaryFile(filepath),
            props = {
                filepath: key
            },
            contents;

        contents = grunt.file.read(filepath, { encoding: isBinary ? null : 'utf8' });

        if (isBinary) {
            props.attachment = contents.toString('base64');
        } else {
            props.body = contents.toString();

            if (key.indexOf('.js') > -1 || key.indexOf('.css') > -1) {
                blok.notify('Found js/css.');
                props.type = 'asset';
            }
        }

        function onUpdate(res) {
            if (res.error) {
                blok.notify('Error uploading file ' + JSON.stringify(res.body), true);
            } else if (!res.error) {
                blok.notify('File "' + key + '" uploaded.');
            }
            done(res.error);
        }
        
        grunt.log.ok('[grunt-blok] - Starts upload of ' + key);
        blok._apiCall('PUT', props, onUpdate);
    };

    blok._apiCall = function(method, props, callback) {
        var themeId = blok._getThemeId();
        var config = grunt.config('blok');
        var req = unirest(method, 'http://' + config.options.url + '/api-v1/theme/' + themeId);

        req.headers({
          "x-api-key": config.options.api_key
        });

        req.type("json");
        req.send(props);
        req.end(callback);
    }

    blok.watchHandler = function(action, filepath) {
        function errorHandler(err) {
            if (err) {
                blok.notify(err.message, true);
            }
        }

        if (!blok._isWatchedPath(filepath)) {
            return;
        }

        if (action === 'deleted') {
            blok.queue.push({
                action: 'remove',
                filepath: filepath,
                done: errorHandler
            });
        } else if (grunt.file.isFile(filepath)) {
            switch (action) {
                case 'added':
                case 'changed':
                case 'renamed':
                blok.queue.push({
                    action: 'upload',
                    filepath: filepath,
                    done: errorHandler
                });
                break;
            }
        } else {
            blok.notify('Skipping non-file ' + filepath);
        }
    };

    return blok;
};
