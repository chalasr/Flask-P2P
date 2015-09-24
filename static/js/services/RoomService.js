(function(app) {
    app.factory('Room', function ($http) {
        return {
            getRooms : function() {
                return $http.get('/get_rooms');
            },
            getUsers : function(room){
                return $http.get('/get_users_in_room/' + room);
            },
        }
    });

})(angular.module('RoomService', []));
