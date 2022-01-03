# Signal K Plugin for PWS Weather

In some ways, all boats are weather stations. This plugin gathers environment data from boat instruments and sends information to PWS Weather (PWSWeather.com). It supports wind speed, gusts, wind direction, temperature, pressure and humidity.

See a sample station [here](https://www.pwsweather.com/station/pws/SVRENAISSANCE).

Important Notes:
  * Requires `navigation.position`, `environment.wind.directionGround`, `environment.wind.speedOverGround` and `environment.outside.temperature`
  * You will likely need [signalk-derived-data](https://github.com/SignalK/signalk-derived-data) plugin for `environment.wind.directionGround` and `environment.wind.speedOverGround`.
  * `environment.outside.pressure` and `environment.outside.humidity` are optional
  * Plugin requires email and password you use on PWS Weather. Ideally this would not be necessary and only an API key would be sufficient. However there is no official API to update the position of a weather station, email and password combination is required for it.
  * You first need to create a station on [PWS Weather](https://pwsweather.com) and enter the corresponding station ID.
