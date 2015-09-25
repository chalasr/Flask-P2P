/*global angular:false */
(function(app) {
    app.factory('Room', function ($http) {
        return {
            getRooms : function() {
                return $http.get('/get_rooms');
            },
            getUsers : function(room){
                return $http.get('/get_users_in_room/' + room);
            },
            leaveRooms : function(wantedRoom, username){
                return $http.get('/leave_other_rooms/' + wantedRoom + '/' + username);
            },
        };
    });

})(angular.module('RoomService', []));
