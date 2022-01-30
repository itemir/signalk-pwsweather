/*
 * Copyright 2022 Ilker Temir <ilker@ilkertemir.com>
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const POLL_INTERVAL = 1      // Poll every N seconds
const UPDATE_POSITION_INTERVAL = 90 // Update every N minutes
const API_URL = 'https://pwsupdate.pwsweather.com/api/v1/submitwx'
const LOGIN_URL = 'https://api.pwsweather.com/auth/login/'
const STATION_LIST_URL = 'https://api.pwsweather.com/user/stations'
const UPDATE_STATION_URL_BASE = 'https://api.pwsweather.com/user/station'
const request = require('request')
const dateFormat = require('dateformat')

const median = arr => {
  const mid = Math.floor(arr.length / 2),
    nums = [...arr].sort((a, b) => a - b);
  return arr.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
};

module.exports = function(app) {
  var plugin = {};
  var unsubscribes = [];
  var submitProcess;
  var statusProcess;
  var positionProcess;
  var lastSuccessfulUpdate;
  var name = app.getSelfPath('name');

  var token;
  var stationApiId;
  var stationName;
  var stationUrl;
  var stationKey;

  var position;
  var windSpeed = [];
  var windGust;
  var windDirection;
  var waterTemperature;
  var temperature;
  var pressure;
  var humidity;

  plugin.id = "signalk-pwsweather";
  plugin.name = "SignalK PWSWeather";
  plugin.description = "PWSWeather plugin for Signal K";

  plugin.schema = {
    type: 'object',
    required: ['stationId', 'email', 'password', 'submitInterval'],
    properties: {
      stationId: {
        type: 'string',
        title: 'Station ID (obtain from PWSWeather.com)'
      },
      email: {
        type: 'string',
        title: 'E-mail (PWSWeather.com)'
      },
      password: {
        type: 'string',
        title: 'Password (PWSWeather.com)'
      },
       submitInterval: {
        type: 'number',
        title: 'Submit Interval (minutes)',
        default: 5
      }
    }
  }

  plugin.start = function(options) {
    if ((!options.email) || (!options.password)) {
      app.error('Email and password are required');
      return
    } 

    loginToPwsWeather(options);

    app.setPluginStatus(`Submitting weather report every ${options.submitInterval} minutes`);

    let subscription = {
      context: 'vessels.self',
      subscribe: [{
        path: 'navigation.position',
        period: POLL_INTERVAL * 1000
      }, {
        path: 'environment.wind.directionGround',
        period: POLL_INTERVAL * 1000
      }, {
        path: 'environment.wind.speedOverGround',
        period: POLL_INTERVAL * 1000
      }, {
        path: 'environment.water.temperature',
        period: POLL_INTERVAL * 1000
      }, {
        path: 'environment.outside.temperature',
        period: POLL_INTERVAL * 1000
      }, {
        path: 'environment.outside.pressure',
        period: POLL_INTERVAL * 1000
      }, {
        path: 'environment.outside.humidity',
        period: POLL_INTERVAL * 1000
      }]
    };

    app.subscriptionmanager.subscribe(subscription, unsubscribes, function() {
      app.debug('Subscription error');
    }, data => processDelta(data));

    app.debug(`Starting submission process every ${options.submitInterval} minutes`);

    statusProcess = setInterval( function() {
      if (!lastSuccessfulUpdate) {
        return;
      }
      let since = timeSince(lastSuccessfulUpdate);
      app.setPluginStatus(`Last successful submission was ${since} ago`);
    }, 60*1000);

    submitProcess = setInterval( function() {
      let now = new Date();
      date = dateFormat(now, 'UTC:yyyy-mm-dd HH:MM:01');
      let httpOptions = {
        uri: API_URL,
        method: 'GET',
	json: true,
	qs: {
          ID: options.stationId,
	  PASSWORD: stationKey,
	  dateutc: date,
	  winddir: windDirection,
	  windspeedmph: median(windSpeed),
	  windgustmph: windGust,
          tempf: temperature,
	  humidity: humidity,
	  baromin: pressure,
	  softwaretype: 'SignalK PWSWeather Plugin',
	  action: 'updateraw'
	}
      };

      app.debug(`Submitting data: ${JSON.stringify(httpOptions)}`);
      request(httpOptions, function (error, response, body) {
        if ((!error || response.statusCode == 200) && body.success == true) {
          app.debug('Weather report successfully submitted');
	  app.debug(JSON.stringify(body));
	  lastSuccessfulUpdate = Date.now();
          position = null;
          windSpeed = [];
          windGust = null;
          windDirection = null;
          waterTemperature = null;
          temperature = null;
          pressure = null;
          humidity = null;
        } else {
          app.debug('Error submitting to PWSWeather.com API');
          app.debug(body); 
	  app.debug('Logging in again');
          loginToPwsWeather(options);
        }
      }); 
    }, options.submitInterval * 60 * 1000);
  }

  plugin.stop =  function() {
    clearInterval(statusProcess);
    clearInterval(submitProcess);
    clearInterval(positionProcess);
    app.setPluginStatus('Pluggin stopped');
  };

  function loginToPwsWeather(options) {
    app.debug('Logging into PWSWeather.com');
    request({
        uri: LOGIN_URL,
        method: 'POST',
	json: true,
	headers: {
          'content-type': 'application/json',
	},
	json: {
	  email: options.email,
	  password: options.password
	}
      }, function (error, response, body) {
        if (!error || response.statusCode == 200) {
          app.debug('Login successful');
	  token = body.response.token;
	  getStationDetails(options.stationId);
	} else {
	  app.debug('Login error');
	  app.debug(JSON.stringify(body));
	}
    });
  }
 
  function getKeyValue(key, maxAge) {
    let data = app.getSelfPath(key);
    if (!data) {
      return null;
    }
    let now = new Date();
    let ts = new Date(data.timestamp);
    let age = (now - ts) / 1000;
    if (age <= maxAge) {
      return data.value
    } else {
      return null;
    }
  }

  function updateStationPosition() {
    app.debug('Updating position');
    let position = getKeyValue('navigation.position', 60);

    if (position == null) {
      app.debug('No position, update failed');
      return;
    }

    request({
        uri: `${UPDATE_STATION_URL_BASE}/${stationApiId}`,
        method: 'PUT',
	json: true,
	headers: {
          'content-type': 'application/json',
	  'authorization': `Bearer ${token}`
	},
	json: {
	  name: stationName,
	  url: stationUrl,
	  pressureType: 'mslp',
	  location: {
	    precision: '6',
	    elev: 1,
            lat: position.latitude,
	    long: position.longitude
	  }
	}
      }, function (error, response, body) {
        app.debug(JSON.stringify(body));
    });
  }

  function getStationDetails(stationId) {
    app.debug('Getting station list');
    request({
        uri: STATION_LIST_URL,
        method: 'GET',
	json: true,
	headers: {
          'content-type': 'application/json',
	  'authorization': `Bearer ${token}`
	}
      }, function (error, response, body) {
        if (!error || response.statusCode == 200) {
          app.debug('Station list retrieved');
	  for (let i=0;i<body.response.stations.length;i++) {
	    let station = body.response.stations[i];
	    if (station.stationId == stationId) {
	      app.debug('Station details obtained');
              stationApiId = station.id;	
	      stationName = station.name;
	      stationUrl = station.url;
	      stationKey = station.appKey;
	      updateStationPosition();
	      positionProcess = setInterval( () => {
	        updateStationPosition();
    	      }, UPDATE_POSITION_INTERVAL * 60 * 1000);
	    }
	  }
	  if (!stationApiId) {
	    app.debug('Could not obtain station details');
          }
	} else {
	  app.debug('Station list retrieve error');
	  app.debug(JSON.stringify(body));
	}
    });
  }

  function metersSecondToMph(value) {
    return value * 2.237;
  }

  function radiantToDegrees(rad) {
    return rad * 57.2958;
  }

  function kelvinToFahrenheit(deg) {
    return (deg - 273.15) * 9 / 5 + 32;
  }

  function pascalToInches(val) {
    return val / 3386.388;
  }

  function processDelta(data) {
    let dict = data.updates[0].values[0];
    let path = dict.path;
    let value = dict.value;

    switch (path) {
      case 'navigation.position':
        position = value;
        break;
      case 'environment.wind.speedOverGround':
        let speed = metersSecondToMph(value);
        speed = speed.toFixed(2);
        speed = parseFloat(speed);
	if ((windGust == null) || (speed > windGust)) {
	  windGust = speed;
	}
	windSpeed.push(speed);
        break;
      case 'environment.wind.directionGround':
        windDirection = radiantToDegrees(value);
        windDirection = Math.round(windDirection);
        break;
      case 'environment.water.temperature':
        waterTemperature = kelvinToFahrenheit(value);
        waterTemperature = waterTemperature.toFixed(1);
        waterTemperature = parseFloat(waterTemperature);
        break;
      case 'environment.outside.temperature':
        temperature = kelvinToFahrenheit(value);
        temperature = temperature.toFixed(1);
        temperature = parseFloat(temperature);
        break;
      case 'environment.outside.pressure':
	pressure = pascalToInches(value);
        pressure= pressure.toFixed(1);
        pressure = parseFloat(pressure);
        break;
      case 'environment.outside.humidity':
        humidity = Math.round(100*parseFloat(value));
        break;
      default:
        app.debug('Unknown path: ' + path);
    }
  }

  function timeSince(date) {
    var seconds = Math.floor((new Date() - date) / 1000);
    var interval = seconds / 31536000;
    if (interval > 1) {
      return Math.floor(interval) + " years";
    }
    interval = seconds / 2592000;
    if (interval > 1) {
      return Math.floor(interval) + " months";
    }
    interval = seconds / 86400;
    if (interval > 1) {
      return Math.floor(interval) + " days";
    }
    interval = seconds / 3600;
    if (interval > 1) {
      let time = Math.floor(interval);
      if (time == 1) {
        return (`${time} hour`);
      } else {
	return (msg = `${time} hours`);
      }
    }
    interval = seconds / 60;
    if (interval > 1) {
      let time = Math.floor(interval);
      if (time == 1) {
        return (`${time} minute`);
      } else {
	return (msg = `${time} minutes`);
      }
    }
    return Math.floor(seconds) + " seconds";
  }

  return plugin;
}
