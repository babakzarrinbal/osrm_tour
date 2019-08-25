var request = require("request");
var { queue } = require("async");
var exp = {
  osrmurl: "http://router.project-osrm.org/route/v1/driving/",
  request: {
    retry: 3,
    retrydelay: 3000,
    threads: 50
  }
};
var round = num => Math.round(num * 10) / 10;

var possibleroutes = function possibleroutes(ar, prev = "") {
  let len = ar.length;
  let result = [];
  if (len == 1) return [prev + ar[0].name];
  for (let i = 0; i < len; i++) {
    let newarr = [...ar.slice(0, i), ...(ar.slice(i + 1) || [])];
    if (ar[i].before && prev.split("-").includes(ar[i].before)) continue;
    if (ar[i].after && newarr.map(a => a.name).includes(ar[i].after)) continue;
    result = result.concat(possibleroutes(newarr, prev + ar[i].name + "-"));
  }
  return result;
};

var requestqueue = queue(function(input, callback) {
  request(input, function(error, response, body) {
    callback({ error, response, body });
  });
}, exp.request.threads);

var requestcache = [];
var requestwq = (input, retries, retry) => {
  let firsttry = !retries;
  if (firsttry) {
    requestcache = requestcache.filter(dc => dc.time > Date.now() - 90000);
    let prevpromis = requestcache.find(dc => dc.input == input);
    if (prevpromis) return prevpromis.promise;
  }
  retries = retries || exp.request.retry;
  retry = retry || 0;
  let resultpromise = new Promise(resolve =>
    requestqueue.push(input, async function(result) {
      if (
        (result.error ||
          (result || {}).body == '{"message":"Too Many Requests"}') &&
        retry <= retries
      ) {
        await new Promise(resolve =>
          setTimeout(resolve, exp.request.retrydelay)
        );
        return resolve(await requestwq(input, retries, retry + 1));
      }
      resolve(result);
    })
  );
  if (firsttry) {
    requestcache.push({
      input,
      time: Date.now(),
      promise: resultpromise
    });
  }
  return resultpromise;
};
//distance with openmap and cached for 5 min

exp.distance = function(args) {
  return new Promise(async resolve => {
    let reject = (error = "input Error") => {
      return resolve({ data: null, error });
    };
    if (args.length % 2 == 1) return reject();
    let waypoint,
      result,
      fromto = "",
      url = "",
      len = args.length,
      reqres;

    // create url
    for (let i = 0; i < len; i++) {
      waypoint = args[i];
      if (!waypoint.lng || !waypoint.lat) {
        url = "error";
        break;
      }
      url += waypoint.lng + "," + waypoint.lat + ";";
      fromto += waypoint.name ? waypoint.name + "-" : "";
    }
    url = url.slice(0, -1); // remove last ";"
    fromto = fromto.slice(0, -1); // remove last "-"

    if (url == "error") return reject();
    reqres = await requestwq(exp.osrmurl + url);

    if (reqres.error) {
      return reject("Error in Request");
    }

    try {
      result = JSON.parse(reqres.body);
    } catch (e) {
      return reject("couldn't parse result: " + reqres.body);
    }
    if (!result.routes || (result.routes[0] || {}).duration == undefined) {
      return reject("can't calculate Route: " + reqres.body);
    }
    return resolve({
      data: {
        fromto,
        geometry: result.routes[0].geometry,
        duration: result.routes[0].duration,
        distance: result.routes[0].distance
      },
      error: null
    });
  });
};

//tour with openmap
exp.tour = WPs =>
  new Promise(async resolve => {
    let reject = (error = "") => resolve({ data: null, error });
    WPs.forEach((wp, i) => {
      if (!wp.name) wp.name = "Loc_" + i;
    });
    let posroutes = possibleroutes(WPs),
      resultroute,
      distances = [],
      traveles = [];
    for (let i = 0; i < posroutes.length; i++) {
      let a = posroutes[i].split("-");
      for (let j = 0; j < a.length - 1; j++) {
        if (!distances.includes(a[j] + "-" + a[j + 1])) {
          distances.push(a[j] + "-" + a[j + 1]);
          traveles.push([
            WPs.find(w => w.name == a[j]),
            WPs.find(w => w.name == a[j + 1])
          ]);
        }
      }
    }
    let travelresult = await Promise.all(traveles.map(t => exp.distance(...t)));
    for (let i = 0; i < posroutes.length; i++) {
      let thisRouteWPs = posroutes[i].split("-");
      let thisroute = {
        fullroute: posroutes[i],
        waypoints: [],
        geometries: [],
        distance: 0,
        duration: 0,
        feasible: true
      };
      for (let j = 0; j < thisRouteWPs.length - 1; j++) {
        let thistravel = travelresult.find(
          t =>
            (t.data || {}).fromto == thisRouteWPs[j] + "-" + thisRouteWPs[j + 1]
        );

        if (!thistravel) {
          thisroute.feasible = false;
          break;
        }
        thistravel = thistravel.data;
        let startWP = thisroute.waypoints.find(
          wp => wp.name == thisRouteWPs[j]
        );
        if (!startWP) {
          let Swaypoint = WPs.find(wp => wp.name == thisRouteWPs[j]);
          startWP = {
            name: Swaypoint.name,
            arrival: 0,
            departure: round(
              (Swaypoint.ready || 0) + (Swaypoint.servicetime || 0)
            ),
            distance: 0,
            passeddue: false
          };
          thisroute.waypoints.push(startWP);
        }
        let Fwaypoint = WPs.find(wp => wp.name == thisRouteWPs[j + 1]);
        let finishWP = {
          name: Fwaypoint.name,
          arrival: round(startWP.departure + thistravel.duration),
          distance: round(startWP.distance + thistravel.distance)
        };
        finishWP.departure = round(
          Math.max(finishWP.arrival, Fwaypoint.ready || 0) +
            (Fwaypoint.servicetime || 0)
        );
        finishWP.passeddue = Fwaypoint.due
          ? Fwaypoint.due < finishWP.arrival
          : false;
        thisroute.waypoints.push(finishWP);
        thisroute.geometries.push(thistravel.geometry);
        thisroute.feasible = finishWP.passeddue ? false : thisroute.feasible;
      }
      let lastwaypoint =
        thisroute.waypoints[thisroute.waypoints.length - 1] || {};
      thisroute.distance = lastwaypoint.distance;
      thisroute.duration = lastwaypoint.departure;

      if (
        !resultroute ||
        (thisroute.feasible && !resultroute.feasible) ||
        (thisroute.feasible == !resultroute.feasible &&
          thisroute.duration <= resultroute.duration)
      )
        resultroute = thisroute;
    }
    if (
      !resultroute.waypoints.length ||
      resultroute.waypoints.length != WPs.length
    )
      return reject({ data: null, error: "can't calc anything" });
    return resolve({ data: resultroute, error: null });
  });

exp.rxltour = WPs =>
  new Promise(async resolve => {
    let waypoints = WPs.map(wp => ({
      name: wp.address,
      lat: wp.lat,
      lng: wp.lng,
      servicetime: wp.servicetime * 60,
      after:
        (wp.restrictions || {}).after &&
        (WPs[wp.restrictions.after] || {}).address,
      before:
        (wp.restrictions || {}).before &&
        (WPs[wp.restrictions.before] || {}).address,
      due: (wp.restrictions || {}).due && wp.restrictions.due * 60,
      ready: (wp.restrictions || {}).ready && wp.restrictions.ready * 60
    }));
    let result = await exp.tour(waypoints);
    if (result.error || !result.data)
      return resolve({
        body: null,
        error: { title: result.error || "Server Error!!!" }
      });
    resolve({
      error: null,
      body: result.data && {
        route: result.data.waypoints.reduce(
          (res, cwp, i) => ({
            ...res,
            [i]: {
              name: cwp.name,
              distance: round(cwp.distance / 1000),
              arrival: round(cwp.arrival / 60)
            }
          }),
          {}
        ),
        fullroute: result.data.fullroute,
        feasible: result.data.feasible,
        distance: round(result.data.distance / 1000),
        duration: round(result.data.duration / 60)
      }
    });
  });

module.exports = exp;
