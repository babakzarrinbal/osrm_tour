# osrm_tour

client Package to calculate distance and
finding optimized routing between diffrent location with/without restrictions
including servingtime, before, after, duetime, readytime from instance of osrm routing server

## Installation

```bash
npm install osrm_tour
```

## Usage

### Distance

to calculate distance between locations

```javaScript
 var osrm  = require('osrm_tour');
 var input = [
     {
        name: String      //name to find the location by if omitted will be loc_1 to loc_n
        lng: Number <longitude>,
        lat: Number <latitude>,
 ]
 // input is arrays of location that come one after another
 osrm.distance(input).then(reponse=>{
     ...
 });
    response = {
      data: {
        fromto: String,     //string from list of names
        geometry:String,    //geometry of traveling polygon to use with you map,
        duration:Number,    //duration in seconds,
        distance:Number     //distance in meters
      },
      error: null // or in case of error string of message
    }
```

### tour

    to calculate best route between locations with/without restriction
    beaware the location quantity increases the calculations exponentialy
    as for 7 location without restriction there is 5040 possibilities...

```javaScript
 var osrm  = require('osrm_tour');
 var input = [
     {
        name: String,           //name to find the location by if omitted will be loc_1 to loc_n
        lng: Number <longitude>,
        lat: Number <latitude>,
        before: String,         //name of location that should be after this location,
        after: String,          //name of location that should be before this location,
        due: Number,            //seconds from route start that this location should be met before,
        ready:Number,           //seconds from route start that this location should be met',
        servicetime: Number,    //seconds that task at this location takes',
     }
 ]
 // input is arrays of location that come one after another
 osrm.tour(input).then(reponse=>{
     ...
 });
 // all times are in seconds and start from route starting
 // all distances are in meteres
    response = {
      data: {
        fullroute:String        //list of locations names in order they are met
        waypoints: [{
            name: String,       //name of location
            arrival:Number,     //arrival time to this waypoint
            departure: Number,  //departure time from this waypoint
            distance: Number,   //distances traveled till this location
            passeddue: Boolean, //if this location is met passed due restriction
        }],
        geometries: [String],   //array of geometries to draw on map
        distance: Number,       //total distance this route traveled
        duration: Number,       //total time this route takes
        feasible: Boolean       //is this route doable with restrictions or not
      },
      error: null               // or in case of error string of message
    }

```
